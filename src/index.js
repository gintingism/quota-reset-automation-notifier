/**
 * Quota Reset Automation - Cloudflare Worker Entrypoint
 * Runs 24/7 via Cron Triggers (`scheduled`) and serves API + Web Dashboard (`fetch`).
 */

import { getAccessToken, AuthRevokedError } from './oauth.js';
import { resolveProjectInfo, fetchAntigravityQuota, triggerAutoWake } from './cloudcode.js';
import { shouldTriggerOnReset, isWithinTimeWindow } from './wake_engine.js';
import { loadDedupState, saveDedupState, sendDedupedAlert, sendAlert } from './notifier.js';
import { fetchCopilotQuota } from './copilot.js';
import { renderDashboardHtml } from './dashboard.js';

const MAX_BODY_BYTES = 64 * 1024;
const WAKE_STATE_KEY = 'wake:state';
const LATEST_KEY = 'latest';

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

function pickPoolModel(agSnapshot, poolName, preferredId) {
  const models = agSnapshot.models || [];
  if (preferredId && models.some((m) => m.id === preferredId)) {
    return preferredId;
  }
  const lower = poolName.toLowerCase();
  if (lower.includes('gemini')) {
    return (
      models.find((m) => m.id === 'gemini-3-flash')?.id ||
      models.find((m) => m.id.includes('gemini'))?.id ||
      preferredId
    );
  }
  if (lower.includes('claude') || lower.includes('gpt')) {
    return (
      models.find((m) => m.id.includes('claude-sonnet'))?.id ||
      models.find((m) => m.id.includes('claude') || m.id.includes('gpt'))?.id ||
      preferredId
    );
  }
  return preferredId;
}

/**
 * Core automation tick: fetch quota, evaluate notifications, and run Auto-Wake per 5h pool.
 */
export async function runAutomationTick(env, options = { forceWake: false }) {
  const nowMs = Date.now();
  const offsetHours = Number(env.TIMEZONE_OFFSET_HOURS ?? 7);
  const dedupState = await loadDedupState(env.QUOTA_KV);
  const wakeState = (env.QUOTA_KV ? await env.QUOTA_KV.get(WAKE_STATE_KEY, 'json') : null) || {};
  wakeState.pools = wakeState.pools || {};
  const providers = {};
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

      // Evaluate Auto-Wake independently for every pool that has a 5h window
      const wakeEnabled = isTrue(env.AUTO_WAKE_ENABLED, true);
      const inWindow = isWithinTimeWindow(env.WAKE_TIME_WINDOW, offsetHours, nowMs);

      for (const group of agSnapshot.groups || []) {
        const fiveHourWin = (group.windows || []).find((w) => w.window_type === '5H');
        if (!fiveHourWin) continue;

        const weeklyWin = (group.windows || []).find((w) => w.window_type === 'WEEKLY');
        const poolKey = group.name.toLowerCase().includes('gemini') ? 'gemini' : 'claude-gpt';
        const preferredModel =
          poolKey === 'gemini'
            ? env.WAKE_GEMINI_MODEL || env.WAKE_MODEL || 'gemini-3-flash'
            : env.WAKE_CLAUDE_MODEL || 'claude-sonnet-5-5-medium';
        const modelId = pickPoolModel(agSnapshot, group.name, preferredModel);
        if (!modelId) continue;

        const poolState = wakeState.pools[poolKey] || {};
        let decision;
        if (options.forceWake) {
          decision = { shouldTrigger: true, reason: 'manual_force' };
        } else if (!wakeEnabled) {
          decision = { shouldTrigger: false, reason: 'disabled' };
        } else if (!inWindow) {
          decision = { shouldTrigger: false, reason: 'outside_time_window' };
        } else if (weeklyWin && weeklyWin.remaining_fraction <= 0) {
          decision = { shouldTrigger: false, reason: 'weekly_exhausted' };
        } else {
          decision = shouldTriggerOnReset(fiveHourWin, poolState, nowMs);
        }

        summary.wakeDecisions[poolKey] = { modelId, ...decision };

        if (decision.shouldTrigger) {
          const wakeResult = await triggerAutoWake(accessToken, projectInfo.projectId, {
            model: modelId,
            prompt: env.WAKE_PROMPT || '1+1',
            maxOutputTokens: env.WAKE_MAX_OUTPUT_TOKENS || 16,
          });
          wakeResult.pool = group.name;

          wakeState.pools[poolKey] = {
            lastTriggerAt: nowMs,
            lastTriggeredResetAt: fiveHourWin.reset_time_iso || null,
            lastWakeResult: wakeResult,
          };
          wakeState.lastWakeResult = wakeResult;
          summary.wakes.push(wakeResult);

          if (isTrue(env.NOTIFY_ON_WAKE, true)) {
            await sendAlert(
              env,
              `🚀 <b>Auto-Wake Executed (${group.name})</b>\nModel: <code>${wakeResult.model}</code>\nReply: <code>${wakeResult.reply.slice(0, 120)}</code>\nTokens: ${wakeResult.totalTokens ?? 'n/a'}`,
            );
          }
        } else if (
          isTrue(env.NOTIFY_ON_RESET, true) &&
          fiveHourWin.remaining_fraction >= 1.0 &&
          fiveHourWin.reset_time_iso &&
          decision.reason !== 'safety_margin' &&
          decision.reason !== 'already_triggered_for_cycle' &&
          decision.reason !== 'cooldown_active'
        ) {
          const sent = await sendDedupedAlert(
            env,
            dedupState,
            `reset:ag:${poolKey}`,
            fiveHourWin.reset_time_iso,
            `✅ <b>${group.name} 5h Reset (100%)</b>\nAuto-Wake skipped: <code>${decision.reason}</code>`,
          );
          if (sent) summary.alerts.push(`reset:${poolKey}`);
        }
      }

      if (summary.wakes.length > 0 && env.QUOTA_KV) {
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
    await Promise.all([
      env.QUOTA_KV.put(LATEST_KEY, JSON.stringify(snapshot)),
      saveDedupState(env.QUOTA_KV, dedupState),
    ]);
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
        await env.QUOTA_KV.put(LATEST_KEY, JSON.stringify(payload));
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
