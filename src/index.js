/**
 * Quota Reset Automation - Cloudflare Worker Entrypoint
 * Runs 24/7 via Cron Triggers (`scheduled`) and serves API + Web Dashboard (`fetch`).
 */

import { getAccessToken, resolveAntigravityAccounts, AuthRevokedError } from './oauth.js';
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
import {
  isGoogleCalendarConfigured,
  loadCalendarSettings,
  saveCalendarSettings,
  loadCalendarSyncState,
  syncWeeklyResetsToGoogle,
} from './calendar.js';
import { HISTORY_KEY, appendHistoryPoint } from './history.js';

const MAX_BODY_BYTES = 64 * 1024;
const WAKE_STATE_KEY = 'wake:state';
const LATEST_KEY = 'latest';
const RATE_LIMIT_BLOCK_MS = 30 * 60 * 1000;
const VALIDATION_BLOCK_MS = 6 * 3600 * 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
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

function isFlashLiteModel(m) {
  const id = (m.id || '').toLowerCase();
  const name = (m.name || '').toLowerCase();
  return id.includes('flash-lite') || name.includes('flash lite') || id.startsWith('gemini-2.5-');
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

  if (lower.includes('gemini')) {
    const gem = safeModels.filter((m) => m.id.includes('gemini') && !m.id.includes('argon'));
    const preferredMatch = normalizedPreferred ? gem.find((m) => m.id === normalizedPreferred) : null;
    if (preferredMatch && preferredMatch.id.includes('flash') && !isFlashLiteModel(preferredMatch)) {
      push(preferredMatch.id);
    }
    gem.filter((m) => m.id.includes('flash') && !isFlashLiteModel(m) && isLowTierModel(m)).forEach((m) => push(m.id));
    gem.filter((m) => m.id.includes('flash') && !isFlashLiteModel(m)).forEach((m) => push(m.id));
    if (preferredMatch && !isFlashLiteModel(preferredMatch)) {
      push(preferredMatch.id);
    }
    gem.filter((m) => !isFlashLiteModel(m) && isLowTierModel(m)).forEach((m) => push(m.id));
    gem.filter((m) => !isFlashLiteModel(m)).forEach((m) => push(m.id));
    gem.filter((m) => isFlashLiteModel(m)).forEach((m) => push(m.id));

    if (gem.length === 0) {
      const allGem = models.filter((m) => m.id.includes('gemini') && !m.id.includes('argon'));
      appendFallbackVariants([
        ...allGem.filter((m) => m.id.includes('flash') && !isFlashLiteModel(m)),
        ...allGem.filter((m) => !isFlashLiteModel(m)),
        ...allGem.filter((m) => isFlashLiteModel(m)),
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

  // 1. Antigravity Cloud Code (primary + optional ANTIGRAVITY_ACCOUNTS multi-account)
  const agAccounts = resolveAntigravityAccounts(env);
  if (agAccounts.length > 0) {
    const accountSnapshots = [];
    const multiAccount = agAccounts.length > 1;
    const lowThreshold = Number(env.LOW_QUOTA_THRESHOLD ?? 20);
    const wakeEnabled = isTrue(env.AUTO_WAKE_ENABLED, true);
    const inWindow = isWithinTimeWindow(env.WAKE_TIME_WINDOW, offsetHours, nowMs);

    for (const account of agAccounts) {
      const isPrimary = account.id === 'primary';
      const labelTag = multiAccount ? ` [${account.label}]` : '';
      const authDedupKey = isPrimary ? 'auth:antigravity' : `auth:antigravity:${account.id}`;

      try {
        const accessToken = await getAccessToken(env, account);
        const projectInfo = await resolveProjectInfo(accessToken, env.QUOTA_KV, account.id);
        const agSnapshot = await fetchAntigravityQuota(accessToken, projectInfo);
        agSnapshot.account_id = account.id;
        agSnapshot.account_label = account.label;

        delete dedupState[authDedupKey];

        if (lowThreshold > 0) {
          for (const group of agSnapshot.groups || []) {
            for (const win of group.windows || []) {
              if (
                win.remaining_percent !== null &&
                win.remaining_percent <= lowThreshold &&
                win.reset_time_iso
              ) {
                const dedupId = isPrimary ? `low:ag:${win.id}` : `low:ag:${account.id}:${win.id}`;
                const sent = await sendDedupedAlert(
                  env,
                  dedupState,
                  dedupId,
                  win.reset_time_iso,
                  `⚠️ <b>Low Quota Alert${labelTag} (${group.name})</b>\nWindow: <code>${win.label}</code>\nSisa: <b>${win.remaining_percent}%</b>\nReset: ${win.reset_time_iso}`,
                );
                if (sent) summary.alerts.push(dedupId);
              }
            }
          }
        }

        const accDecisions = {};
        for (const group of agSnapshot.groups || []) {
          const fiveHourWin = (group.windows || []).find((w) => w.window_type === '5H');
          const weeklyWin = (group.windows || []).find((w) => w.window_type === 'WEEKLY');
          const targetWin = fiveHourWin || weeklyWin || (group.windows || [])[0];
          if (!targetWin) continue;
          const lowerGroup = group.name.toLowerCase();
          if (lowerGroup.includes('argon')) continue; // Argon removed from Antigravity
          const basePoolKey = lowerGroup.includes('gemini') ? 'gemini' : 'claude-gpt';
          const stateKey = isPrimary ? basePoolKey : `${account.id}:${basePoolKey}`;
          const preferredModel =
            basePoolKey === 'gemini'
              ? env.WAKE_GEMINI_MODEL || env.WAKE_MODEL || 'gemini-3.8-flash-low'
              : env.WAKE_CLAUDE_MODEL || 'claude-sonnet-5-5-low';
          const candidates = getPoolCandidateModels(agSnapshot, group.name, preferredModel);
          const modelId = candidates[0];
          if (!modelId) continue;

          const poolState = wakeState.pools[stateKey] || {};
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

          accDecisions[basePoolKey] = { modelId, ...decision };
          summary.wakeDecisions[stateKey] = { modelId, ...decision };

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
                  wakeState.pools[stateKey] = {
                    ...poolState,
                    blockedUntil: nowMs + blockMs,
                    blockCode: err.code,
                  };
                  wakeStateDirty = true;
                  accDecisions[basePoolKey] = {
                    modelId: candidateModel,
                    shouldTrigger: false,
                    reason: `blocked:${err.code}`,
                  };
                  summary.wakeDecisions[stateKey] = accDecisions[basePoolKey];
                  await sendDedupedAlert(
                    env,
                    dedupState,
                    `limit:ag:${stateKey}`,
                    `${err.code}:${Math.floor(nowMs / 3600000)}`,
                    `🛑 <b>Auto-Wake Paused${labelTag} (${group.name})</b>\nAlasan: <code>${err.code}</code>\n${err.message}`,
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
                accDecisions[basePoolKey] = {
                  modelId: candidates[0],
                  shouldTrigger: false,
                  reason: 'wake_failed',
                  error: lastWakeErr.message,
                };
                summary.wakeDecisions[stateKey] = accDecisions[basePoolKey];
              }
              continue;
            }

            wakeResult.pool = group.name;
            wakeResult.account = account.label;
            const cycleMs = targetWin.window_type === 'WEEKLY' ? 7 * 24 * 3600 * 1000 : 5 * 3600 * 1000;
            const recordedResetAt =
              targetWin.reset_time_iso || new Date(nowMs + cycleMs).toISOString();
            wakeState.pools[stateKey] = {
              lastTriggerAt: nowMs,
              lastTriggeredResetAt: recordedResetAt,
              lastWakeResult: wakeResult,
            };
            wakeState.lastWakeResult = wakeResult;
            wakeStateDirty = true;
            summary.wakes.push(wakeResult);
            accDecisions[basePoolKey] = { modelId: wakeResult.model, ...decision };
            summary.wakeDecisions[stateKey] = accDecisions[basePoolKey];

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
                `🚀 <b>Auto-Wake Executed${labelTag} (${group.name})</b>\nModel: <code>${wakeResult.model}</code>\nReply: <code>${wakeResult.reply.slice(0, 120)}</code>\nTokens: ${tokenStr}`,
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
              `reset:ag:${stateKey}`,
              cycleToken,
              `✅ <b>${group.name}${labelTag} ${targetWin.label} (100%)</b>\nAuto-Wake skipped: <code>${decision.reason}</code>`,
            );
            if (sent) summary.alerts.push(`reset:${stateKey}`);
          }
        }

        agSnapshot.wake_decisions = accDecisions;
        if (isPrimary) providers.antigravity = agSnapshot;
        accountSnapshots.push({ id: account.id, label: account.label, ...agSnapshot });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const errSnap = {
          account_id: account.id,
          account_label: account.label,
          quota_percent: null,
          reset_at: null,
          models: [],
          groups: [],
          source: 'cloudcode',
          estimated: false,
          error: msg,
          fetched_at: Math.floor(nowMs / 1000),
        };
        if (isPrimary) {
          providers.antigravity = errSnap;
          summary.ok = false;
          summary.antigravityError = msg;
        }
        accountSnapshots.push({ id: account.id, label: account.label, ...errSnap });

        if (err instanceof AuthRevokedError) {
          await sendDedupedAlert(
            env,
            dedupState,
            authDedupKey,
            'revoked',
            `🔐 <b>Antigravity Auth Expired${labelTag}</b>\n${msg}\nJalankan ulang <code>npm run auth</code> lalu update secret refresh token.`,
          );
        }
      }
    }

    if (!providers.antigravity && accountSnapshots.length > 0) {
      providers.antigravity = accountSnapshots[0];
    }
    providers.antigravity_accounts = accountSnapshots;

    if (wakeStateDirty && env.QUOTA_KV) {
      await env.QUOTA_KV.put(WAKE_STATE_KEY, JSON.stringify(wakeState));
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
    const prevHistory = await env.QUOTA_KV.get(HISTORY_KEY, 'json');
    const hist = appendHistoryPoint(prevHistory, snapshot, nowMs);
    if (hist.changed) {
      kvWrites.push(env.QUOTA_KV.put(HISTORY_KEY, JSON.stringify(hist.points)));
    }
    await Promise.all(kvWrites);
  }

  if (isGoogleCalendarConfigured(env)) {
    try {
      summary.calendar = await syncWeeklyResetsToGoogle(env, snapshot);
    } catch (err) {
      summary.calendar = {
        ok: false,
        configured: true,
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }
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
      const [latest, wakeState, calendarSettings, calendarSyncState, history] = env.QUOTA_KV
        ? await Promise.all([
            env.QUOTA_KV.get(LATEST_KEY, 'json'),
            env.QUOTA_KV.get(WAKE_STATE_KEY, 'json'),
            loadCalendarSettings(env.QUOTA_KV),
            loadCalendarSyncState(env.QUOTA_KV),
            env.QUOTA_KV.get(HISTORY_KEY, 'json'),
          ])
        : [null, null, null, null, []];
      const offsetHours = Number(env.TIMEZONE_OFFSET_HOURS ?? 7);
      const calendarInfo = {
        configured: isGoogleCalendarConfigured(env),
        settings: calendarSettings,
        lastSyncedAt: calendarSyncState?.lastSyncedAt || null,
      };
      return new Response(renderDashboardHtml(latest, wakeState, offsetHours, calendarInfo, history || []), {
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

    if (url.pathname === '/api/quota/history' && request.method === 'GET') {
      const history = env.QUOTA_KV ? (await env.QUOTA_KV.get(HISTORY_KEY, 'json')) || [] : [];
      return jsonResponse({ points: history });
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

        if (isGoogleCalendarConfigured(env)) {
          try {
            await syncWeeklyResetsToGoogle(env, merged);
          } catch {
            // Non-blocking: extension sync still succeeds
          }
        }
      }
      return jsonResponse({ ok: true });
    }

    if (url.pathname === '/api/settings/calendar' && request.method === 'GET') {
      const [settings, syncState] = await Promise.all([
        loadCalendarSettings(env.QUOTA_KV),
        loadCalendarSyncState(env.QUOTA_KV),
      ]);
      return jsonResponse({
        configured: isGoogleCalendarConfigured(env),
        settings,
        lastSyncedAt: syncState.lastSyncedAt,
      });
    }

    if (url.pathname === '/api/settings/calendar' && (request.method === 'PUT' || request.method === 'POST')) {
      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
      }
      const settings = await saveCalendarSettings(env.QUOTA_KV, body);
      const configured = isGoogleCalendarConfigured(env);
      let sync = null;
      if (configured && settings.enabled && env.QUOTA_KV) {
        const latest = await env.QUOTA_KV.get(LATEST_KEY, 'json');
        if (latest) {
          sync = await syncWeeklyResetsToGoogle(env, latest, { settings });
        }
      }
      return jsonResponse({ ok: true, configured, settings, sync });
    }

    if (url.pathname === '/api/calendar/sync' && request.method === 'POST') {
      const latest = env.QUOTA_KV ? await env.QUOTA_KV.get(LATEST_KEY, 'json') : null;
      if (!latest) return jsonResponse({ error: 'No snapshot' }, 404);
      const result = await syncWeeklyResetsToGoogle(env, latest, { force: true });
      return jsonResponse(result, result.configured ? 200 : 400);
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
