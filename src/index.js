/**
 * Quota Reset Automation - Cloudflare Worker Entrypoint
 * Runs 24/7 via Cron Triggers (`scheduled`) and serves API + Web Dashboard (`fetch`).
 */

import { getAccessToken, AuthRevokedError } from './oauth.js';
import {
  resolveProjectInfo,
  fetchAntigravityQuota,
  triggerAutoWake,
  normalizeLowModelId,
  CloudCodeLimitError,
} from './cloudcode.js';
import { shouldTriggerOnReset, isWithinTimeWindow } from './wake_engine.js';
import { loadDedupState, saveDedupState, sendDedupedAlert, sendAlert } from './notifier.js';
import { fetchCopilotQuota } from './copilot.js';
import { renderDashboardHtml } from './dashboard.js';

const MAX_BODY_BYTES = 64 * 1024;
const WAKE_STATE_KEY = 'wake:state';
const LATEST_KEY = 'latest';
const RATE_LIMIT_BLOCK_MS = 30 * 60 * 1000;
const VALIDATION_BLOCK_MS = 6 * 3600 * 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function isAuthorized(request, env) {
  return Boolean(env.AUTH_TOKEN && request.headers.get('X-Auth-Token') === env.AUTH_TOKEN);
}

function isTrue(val, defaultVal = false) {
  if (val === undefined || val === null || val === '') return defaultVal;
  return String(val).toLowerCase() === 'true' || String(val) === '1';
}

function validSyncPayload(payload) {
  if (!payload || payload.version !== 1 || typeof payload.providers !== 'object') return false;
  return Object.values(payload.providers).every(
    (provider) =>
      provider &&
      typeof provider === 'object' &&
      (provider.quota_percent === null || typeof provider.quota_percent === 'number') &&
      (provider.models === undefined || Array.isArray(provider.models)),
  );
}

function isLowTierModel(m) {
  const id = (m.id || '').toLowerCase();
  const name = (m.name || '').toLowerCase();
  return (
    id.endsWith('-low') ||
    id.includes('-low-') ||
    id.includes('flash-lite') ||
    /\b(low|lite)\b/.test(name)
  );
}

function isMediumOrHighTierModel(m) {
  const id = (m.id || '').toLowerCase();
  const name = (m.name || '').toLowerCase();
  return (
    id.endsWith('-medium') ||
    id.endsWith('-high') ||
    id.includes('-medium-') ||
    id.includes('-high-') ||
    /\b(medium|high)\b/.test(name)
  );
}

export function getPoolCandidateModels(agSnapshot, poolName, preferredId) {
  const models = agSnapshot?.models || [];
  const normalizedPreferred = normalizeLowModelId(preferredId);
  const lower = (poolName || '').toLowerCase();
  const safeModels = models.filter((m) => !isMediumOrHighTierModel(m));

  const ranked = [];
  const push = (id) => {
    if (id && !ranked.includes(id)) ranked.push(id);
  };
  const appendFallbackVariants = (poolModels) => {
    poolModels.forEach((m) => push(normalizeLowModelId(m.id)));
    poolModels.forEach((m) => push(m.id));
  };

  if (lower.includes('argon')) {
    const isArgon = (m) => m.id.toLowerCase().includes('argon') || (m.name || '').toLowerCase().includes('argon');
    safeModels.filter((m) => isArgon(m) && isLowTierModel(m)).forEach((m) => push(m.id));
    safeModels.filter(isArgon).forEach((m) => push(m.id));
    if (ranked.length === 0) {
      appendFallbackVariants(models.filter(isArgon));
    }
    push(normalizedPreferred || 'gemini-4-argon-low');
    return ranked;
  }

  if (lower.includes('gemini')) {
    const gem = safeModels.filter((m) => m.id.includes('gemini') && !m.id.includes('argon'));
    gem.filter((m) => m.id.includes('flash') && !m.id.includes('flash-lite') && isLowTierModel(m)).forEach((m) => push(m.id));
    gem.filter((m) => m.id.includes('flash') && !m.id.includes('flash-lite')).forEach((m) => push(m.id));
    if (normalizedPreferred && gem.some((m) => m.id === normalizedPreferred)) {
      push(normalizedPreferred);
    }
    gem.filter((m) => m.id.includes('flash-lite')).forEach((m) => push(m.id));
    gem.filter((m) => isLowTierModel(m)).forEach((m) => push(m.id));
    gem.forEach((m) => push(m.id));

    if (gem.length === 0) {
      const allGem = models.filter((m) => m.id.includes('gemini') && !m.id.includes('argon'));
      appendFallbackVariants([
        ...allGem.filter((m) => m.id.includes('flash')),
        ...allGem.filter((m) => !m.id.includes('flash')),
      ]);
      push(normalizedPreferred);
      push('gemini-3.8-flash-low');
      push('gemini-3.8-flash');
      push('gemini-3-flash');
    }
    return ranked;
  }

  if (lower.includes('claude') || lower.includes('gpt')) {
    const cg = safeModels.filter((m) => m.id.includes('claude') || m.id.includes('gpt'));
    cg.filter((m) => m.id.includes('claude-sonnet') && isLowTierModel(m)).forEach((m) => push(m.id));
    cg.filter((m) => isLowTierModel(m)).forEach((m) => push(m.id));
    if (normalizedPreferred && cg.some((m) => m.id === normalizedPreferred)) {
      push(normalizedPreferred);
    }
    cg.filter((m) => m.id.includes('claude-sonnet')).forEach((m) => push(m.id));
    cg.forEach((m) => push(m.id));
    if (cg.length === 0) {
      appendFallbackVariants(models.filter((m) => m.id.includes('claude') || m.id.includes('gpt')));
      push(normalizedPreferred || 'claude-sonnet-5-5-low');
    }
    return ranked;
  }

  safeModels.filter((m) => isLowTierModel(m)).forEach((m) => push(m.id));
  safeModels.forEach((m) => push(m.id));
  push(normalizedPreferred);
  return ranked;
}

export function pickPoolModel(agSnapshot, poolName, preferredId) {
  return getPoolCandidateModels(agSnapshot, poolName, preferredId)[0];
}

/**
 * Core automation tick: fetch quota, evaluate notifications, and run Auto-Wake per 5h pool.
 */
export async function runAutomationTick(env, options = { forceWake: false }) {
  const nowMs = Date.now();
  const offsetHours = Number(env.TIMEZONE_OFFSET_HOURS ?? 7);
  const dedupState = await loadDedupState(env.QUOTA_KV);
  const dedupBefore = JSON.stringify(dedupState);
  const wakeState = (env.QUOTA_KV ? await env.QUOTA_KV.get(WAKE_STATE_KEY, 'json') : null) || {};
  wakeState.pools = wakeState.pools || {};
  let wakeStateDirty = false;
  const existingLatest = env.QUOTA_KV ? await env.QUOTA_KV.get(LATEST_KEY, 'json') : null;
  const providers = {};
  if (existingLatest?.providers?.gemini_web) {
    providers.gemini_web = existingLatest.providers.gemini_web;
  }
  const summary = { ok: true, wakes: [], wakeDecisions: {}, alerts: [] };

  // 1. Antigravity Cloud Code
  if (env.ANTIGRAVITY_REFRESH_TOKEN) {
    try {
      const accessToken = await getAccessToken(env);
      const projectInfo = await resolveProjectInfo(accessToken, env.QUOTA_KV);
      const agSnapshot = await fetchAntigravityQuota(accessToken, projectInfo);
      providers.antigravity = agSnapshot;

      // Clear previous auth error dedup once healthy
      delete dedupState['auth:antigravity'];

      // Evaluate Low Quota Alerts across pools
      const lowThreshold = Number(env.LOW_QUOTA_THRESHOLD ?? 20);
      if (lowThreshold > 0) {
        for (const group of agSnapshot.groups || []) {
          for (const win of group.windows || []) {
            if (
              win.remaining_percent !== null &&
              win.remaining_percent <= lowThreshold &&
              win.reset_time_iso
            ) {
              const sent = await sendDedupedAlert(
                env,
                dedupState,
                `low:ag:${win.id}`,
                win.reset_time_iso,
                `⚠️ <b>Low Quota Alert (${group.name})</b>\nWindow: <code>${win.label}</code>\nSisa: <b>${win.remaining_percent}%</b>\nReset: ${win.reset_time_iso}`,
              );
              if (sent) summary.alerts.push(`low:${win.id}`);
            }
          }
        }
      }

      // Evaluate Auto-Wake independently for every pool (5h window, or weekly-only pool like Gemini 4 Argon)
      const wakeEnabled = isTrue(env.AUTO_WAKE_ENABLED, true);
      const inWindow = isWithinTimeWindow(env.WAKE_TIME_WINDOW, offsetHours, nowMs);

      for (const group of agSnapshot.groups || []) {
        const fiveHourWin = (group.windows || []).find((w) => w.window_type === '5H');
        const weeklyWin = (group.windows || []).find((w) => w.window_type === 'WEEKLY');
        const targetWin = fiveHourWin || weeklyWin;
        if (!targetWin) continue;
        const lowerGroup = group.name.toLowerCase();
        const poolKey = lowerGroup.includes('argon')
          ? 'argon'
          : lowerGroup.includes('gemini')
            ? 'gemini'
            : 'claude-gpt';
        const preferredModel =
          poolKey === 'argon'
            ? env.WAKE_ARGON_MODEL || 'gemini-4-argon-low'
            : poolKey === 'gemini'
              ? env.WAKE_GEMINI_MODEL || env.WAKE_MODEL || 'gemini-3.8-flash-low'
              : env.WAKE_CLAUDE_MODEL || 'claude-sonnet-5-5-low';
        const candidates = getPoolCandidateModels(agSnapshot, group.name, preferredModel);
        const modelId = candidates[0];
        if (!modelId) continue;

        const poolState = wakeState.pools[poolKey] || {};
        const isBlocked = typeof poolState.blockedUntil === 'number' && nowMs < poolState.blockedUntil;
        let decision;
        if (options.forceWake) {
          decision = { shouldTrigger: true, reason: 'manual_force' };
        } else if (!wakeEnabled) {
          decision = { shouldTrigger: false, reason: 'disabled' };
        } else if (isBlocked) {
          decision = { shouldTrigger: false, reason: `blocked:${poolState.blockCode || 'limit'}` };
        } else if (!inWindow) {
          decision = { shouldTrigger: false, reason: 'outside_time_window' };
        } else if (weeklyWin && weeklyWin.remaining_fraction <= 0) {
          decision = { shouldTrigger: false, reason: 'weekly_exhausted' };
        } else {
          decision = shouldTriggerOnReset(targetWin, poolState, nowMs);
        }

        summary.wakeDecisions[poolKey] = { modelId, ...decision };

        if (decision.shouldTrigger) {
          let wakeResult = null;
          let lastWakeErr = null;
          let limitBlocked = false;

          for (const candidateModel of candidates.slice(0, 5)) {
            try {
              wakeResult = await triggerAutoWake(accessToken, projectInfo.projectId, {
                model: candidateModel,
                allowExactModel: !isLowTierModel({ id: candidateModel, name: '' }),
                prompt: env.WAKE_PROMPT || '1+1=',
                maxOutputTokens: env.WAKE_MAX_OUTPUT_TOKENS || 1,
              });
              break;
            } catch (err) {
              lastWakeErr = err;
              if (err instanceof CloudCodeLimitError) {
                limitBlocked = true;
                const blockMs = err.code === 'rate_limited' ? RATE_LIMIT_BLOCK_MS : VALIDATION_BLOCK_MS;
                wakeState.pools[poolKey] = {
                  ...poolState,
                  blockedUntil: nowMs + blockMs,
                  blockCode: err.code,
                };
                wakeStateDirty = true;
                summary.wakeDecisions[poolKey] = {
                  modelId: candidateModel,
                  shouldTrigger: false,
                  reason: `blocked:${err.code}`,
                };
                await sendDedupedAlert(
                  env,
                  dedupState,
                  `limit:ag:${poolKey}`,
                  `${err.code}:${Math.floor(nowMs / 3600000)}`,
                  `🛑 <b>Auto-Wake Paused (${group.name})</b>\nAlasan: <code>${err.code}</code>\n${err.message}`,
                );
                break;
              }
              if (!/failed \((?:400|404)\)/.test(err?.message || '')) {
                break;
              }
            }
          }

          if (!wakeResult) {
            if (!limitBlocked && lastWakeErr) {
              summary.wakeDecisions[poolKey] = {
                modelId: candidates[0],
                shouldTrigger: false,
                reason: 'wake_failed',
                error: lastWakeErr.message,
              };
            }
            continue;
          }

          wakeResult.pool = group.name;
          const cycleMs = targetWin.window_type === 'WEEKLY' ? 7 * 24 * 3600 * 1000 : 5 * 3600 * 1000;
          const recordedResetAt =
            targetWin.reset_time_iso || new Date(nowMs + cycleMs).toISOString();
          wakeState.pools[poolKey] = {
            lastTriggerAt: nowMs,
            lastTriggeredResetAt: recordedResetAt,
            lastWakeResult: wakeResult,
          };
          wakeState.lastWakeResult = wakeResult;
          wakeStateDirty = true;
          summary.wakes.push(wakeResult);
          summary.wakeDecisions[poolKey] = { modelId: wakeResult.model, ...decision };

          if (isTrue(env.NOTIFY_ON_WAKE, true)) {
            const tokenParts = [];
            if (wakeResult.promptTokens !== null) tokenParts.push(`in:${wakeResult.promptTokens}`);
            if (wakeResult.thoughtsTokens !== null) tokenParts.push(`think:${wakeResult.thoughtsTokens}`);
            if (wakeResult.outputTokens !== null) tokenParts.push(`out:${wakeResult.outputTokens}`);
            const tokenStr =
              wakeResult.totalTokens !== null
                ? `${wakeResult.totalTokens}${tokenParts.length ? ` (${tokenParts.join(', ')})` : ''}`
                : 'n/a';

            await sendAlert(
              env,
              `🚀 <b>Auto-Wake Executed (${group.name})</b>\nModel: <code>${wakeResult.model}</code>\nReply: <code>${wakeResult.reply.slice(0, 120)}</code>\nTokens: ${tokenStr}`,
            );
          }
        } else if (
          isTrue(env.NOTIFY_ON_RESET, true) &&
          targetWin.remaining_fraction >= 1.0 &&
          decision.reason !== 'safety_margin' &&
          decision.reason !== 'already_triggered_for_cycle' &&
          decision.reason !== 'cooldown_active' &&
          !decision.reason.startsWith('blocked:')
        ) {
          const cycleToken = targetWin.reset_time_iso || weeklyWin?.reset_time_iso || `${decision.reason}:idle`;
          const sent = await sendDedupedAlert(
            env,
            dedupState,
            `reset:ag:${poolKey}`,
            cycleToken,
            `✅ <b>${group.name} ${targetWin.label} (100%)</b>\nAuto-Wake skipped: <code>${decision.reason}</code>`,
          );
          if (sent) summary.alerts.push(`reset:${poolKey}`);
        }
      }

      agSnapshot.wake_decisions = summary.wakeDecisions;
      if (wakeStateDirty && env.QUOTA_KV) {
        await env.QUOTA_KV.put(WAKE_STATE_KEY, JSON.stringify(wakeState));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      providers.antigravity = {
        quota_percent: null,
        reset_at: null,
        models: [],
        source: 'cloudcode',
        estimated: false,
        error: msg,
        fetched_at: Math.floor(nowMs / 1000),
      };
      summary.ok = false;
      summary.antigravityError = msg;

      if (err instanceof AuthRevokedError) {
        await sendDedupedAlert(
          env,
          dedupState,
          'auth:antigravity',
          'revoked',
          `🔐 <b>Antigravity Auth Expired</b>\n${msg}\nJalankan ulang <code>npm run auth</code> lalu update secret <code>ANTIGRAVITY_REFRESH_TOKEN</code>.`,
        );
      }
    }
  }

  // 2. GitHub Copilot (monthly AI credits monitoring + alerts, no Auto-Wake)
  if (env.GITHUB_TOKEN) {
    const copilotSnapshot = await fetchCopilotQuota(env.GITHUB_TOKEN);
    if (copilotSnapshot) {
      providers.github_copilot = copilotSnapshot;

      const lowThreshold = Number(env.LOW_QUOTA_THRESHOLD ?? 20);
      if (
        !copilotSnapshot.error &&
        lowThreshold > 0 &&
        copilotSnapshot.quota_percent !== null &&
        copilotSnapshot.quota_percent <= lowThreshold &&
        copilotSnapshot.reset_time_iso
      ) {
        const sent = await sendDedupedAlert(
          env,
          dedupState,
          'low:copilot',
          copilotSnapshot.reset_time_iso,
          `⚠️ <b>Low Quota Alert (GitHub Copilot)</b>\nAI Credits sisa: <b>${copilotSnapshot.percent_remaining}%</b> (${copilotSnapshot.credits_remaining ?? '?'} / ${copilotSnapshot.credits_entitlement ?? '?'})\nReset: ${copilotSnapshot.reset_time_iso}`,
        );
        if (sent) summary.alerts.push('low:copilot');
      }

      if (
        !copilotSnapshot.error &&
        isTrue(env.NOTIFY_ON_RESET, true) &&
        copilotSnapshot.quota_percent !== null &&
        copilotSnapshot.quota_percent >= 100 &&
        copilotSnapshot.reset_time_iso
      ) {
        const sent = await sendDedupedAlert(
          env,
          dedupState,
          'reset:copilot',
          copilotSnapshot.reset_time_iso,
          `✅ <b>GitHub Copilot Monthly Reset (100%)</b>\nAI Credits: ${copilotSnapshot.credits_entitlement ?? 200} siap dipakai.\nReset berikutnya: ${copilotSnapshot.reset_time_iso}`,
        );
        if (sent) summary.alerts.push('reset:copilot');
      }
    }
  }

  const snapshot = {
    version: 1,
    fetched_at: Math.floor(nowMs / 1000),
    providers,
  };

  if (env.QUOTA_KV) {
    const kvWrites = [env.QUOTA_KV.put(LATEST_KEY, JSON.stringify(snapshot))];
    if (JSON.stringify(dedupState) !== dedupBefore) {
      kvWrites.push(saveDedupState(env.QUOTA_KV, dedupState));
    }
    await Promise.all(kvWrites);
  }

  return { summary, snapshot };
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runAutomationTick(env));
  },

  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return jsonResponse({ ok: true, service: 'quota-reset-automation' });
    }

    if (url.pathname === '/' && request.method === 'GET') {
      const [latest, wakeState] = env.QUOTA_KV
        ? await Promise.all([
            env.QUOTA_KV.get(LATEST_KEY, 'json'),
            env.QUOTA_KV.get(WAKE_STATE_KEY, 'json'),
          ])
        : [null, null];
      const offsetHours = Number(env.TIMEZONE_OFFSET_HOURS ?? 7);
      return new Response(renderDashboardHtml(latest, wakeState, offsetHours), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (!url.pathname.startsWith('/api/')) {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    if (!isAuthorized(request, env)) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    if (url.pathname === '/api/quota/latest' && request.method === 'GET') {
      const latest = env.QUOTA_KV ? await env.QUOTA_KV.get(LATEST_KEY, 'json') : null;
      return latest ? jsonResponse(latest) : jsonResponse({ error: 'No snapshot' }, 404);
    }

    if (url.pathname === '/api/quota/sync' && request.method === 'POST') {
      if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) {
        return jsonResponse({ error: 'Payload too large' }, 413);
      }
      let payload;
      try {
        const text = await request.text();
        if (text.length > MAX_BODY_BYTES) return jsonResponse({ error: 'Payload too large' }, 413);
        payload = JSON.parse(text);
      } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
      }
      if (!validSyncPayload(payload)) return jsonResponse({ error: 'Invalid quota payload' }, 422);
      if (env.QUOTA_KV) {
        const existing = (await env.QUOTA_KV.get(LATEST_KEY, 'json')) || {
          version: 1,
          fetched_at: Math.floor(Date.now() / 1000),
          providers: {},
        };
        const merged = {
          version: 1,
          fetched_at: existing.fetched_at || Math.floor(Date.now() / 1000),
          providers: {
            ...(existing.providers || {}),
            ...(payload.providers || {}),
          },
        };
        await env.QUOTA_KV.put(LATEST_KEY, JSON.stringify(merged));

        // Alert on low Gemini Web quota if synced from extension
        const gw = payload.providers?.gemini_web;
        const lowThreshold = Number(env.LOW_QUOTA_THRESHOLD ?? 20);
        if (gw && lowThreshold > 0 && typeof gw.quota_percent === 'number' && gw.quota_percent <= lowThreshold) {
          const dedupState = await loadDedupState(env.QUOTA_KV);
          const cycle = gw.daily_reset_label || gw.weekly_reset_label || String(Math.floor(Date.now() / 3600000));
          const sent = await sendDedupedAlert(
            env,
            dedupState,
            'low:gemini_web',
            cycle,
            `⚠️ <b>Low Quota Alert (Gemini Web)</b>\nSisa sesi: <b>${gw.quota_percent}%</b>\nReset: ${gw.daily_reset_label || '—'}`,
          );
          if (sent) await saveDedupState(env.QUOTA_KV, dedupState);
        }
      }
      return jsonResponse({ ok: true });
    }

    if (url.pathname === '/api/automation/tick' && request.method === 'POST') {
      const result = await runAutomationTick(env, { forceWake: false });
      return jsonResponse(result);
    }

    if (url.pathname === '/api/automation/wake' && request.method === 'POST') {
      const result = await runAutomationTick(env, { forceWake: true });
      return jsonResponse(result);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};
