const ALARM_NAME = 'gemini-web-sync';
const DEFAULT_INTERVAL_MIN = 15;
const SYNC_TIMEOUT_MS = 15000;
const GEMINI_BASE = 'https://gemini.google.com';

const GEMINI_PLAN_MAP = {
  1: 'Free',
  2: 'Work',
  3: 'AI Plus',
  4: 'AI Plus',
  5: 'AI Pro',
  6: 'AI Ultra',
};

const GEMINI_POLICY_TIER = {
  basic_policy: 'Free',
  brownfield_basic_policy: 'Free',
  v3p2_basic_policy: 'Free',
  v3p2_free_policy: 'Free',
  brownfield_paid_policy: 'AI Plus',
  v3p2_plus_policy: 'AI Plus',
  plus_policy: 'AI Pro',
  v3p2_pro_policy: 'AI Pro',
  launch_pro_policy: 'AI Pro',
  launch_chat_pro_policy: 'AI Pro',
  neon_policy: 'AI Ultra',
  v3p2_ultra_policy: 'AI Ultra',
  launch_ultra_mode_ultra_policy: 'AI Ultra',
};

let syncTimeoutId = null;
let isSyncing = false;

function decodeBatchExecuteEnvelope(rawText, rpcId) {
  if (typeof rawText !== 'string') return null;
  for (const line of rawText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('[[')) continue;
    try {
      const rows = JSON.parse(trimmed);
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (Array.isArray(row) && row[0] === 'wrb.fr' && row[1] === rpcId && typeof row[2] === 'string') {
          return JSON.parse(row[2]);
        }
      }
    } catch {
      // Ignore framing lines
    }
  }
  return null;
}

function collectPolicies(node, acc = []) {
  if (typeof node === 'string') {
    if (/_policy$/.test(node) && !acc.includes(node)) acc.push(node);
  } else if (Array.isArray(node)) {
    for (const item of node) collectPolicies(item, acc);
  }
  return acc;
}

function resolveGeminiPlanTier(planId, otPayload = null) {
  const policies = collectPolicies(otPayload, []);
  for (const p of policies) {
    if (GEMINI_POLICY_TIER[p]) return GEMINI_POLICY_TIER[p];
  }
  return GEMINI_PLAN_MAP[planId] || 'AI Pro';
}

function formatClockLabel(iso) {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'Unknown';
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatDateClockLabel(iso) {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'Unknown';
  return d.toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function callBatchExecuteRpc(rpcId, atToken) {
  const innerReq = JSON.stringify([[[rpcId, '[]', null, 'generic']]]);
  const body = `f.req=${encodeURIComponent(innerReq)}&at=${encodeURIComponent(atToken)}&`;
  const url = `${GEMINI_BASE}/_/BardChatUi/data/batchexecute?rpcids=${encodeURIComponent(rpcId)}&source-path=%2Fusage&hl=en&rt=c`;

  const resp = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'X-Same-Domain': '1',
    },
    body,
    cache: 'no-store',
  });
  if (!resp.ok) throw new Error(`RPC ${rpcId} HTTP ${resp.status}`);
  const text = await resp.text();
  return decodeBatchExecuteEnvelope(text, rpcId);
}

class GeminiAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GeminiAuthError';
  }
}

/**
 * Lightweight zero-iframe RPC fetch (<2 MB RAM, ~400ms) using Gemini's `jSf9Qc` and `otAQ7b` batchexecute endpoints.
 */
async function fetchGeminiViaRpc() {
  const pageResp = await fetch(`${GEMINI_BASE}/app`, {
    credentials: 'include',
    cache: 'no-store',
  });
  if (!pageResp.ok || (pageResp.redirected && pageResp.url.includes('accounts.google'))) {
    throw new GeminiAuthError('Not logged into Gemini');
  }
  const html = await pageResp.text();
  const atMatch = html.match(/"SNlM0e":"([^"]+)"/);
  if (!atMatch) throw new GeminiAuthError('Not logged into Gemini');
  const atToken = atMatch[1];

  const [quotaPayload, policyPayload] = await Promise.all([
    callBatchExecuteRpc('jSf9Qc', atToken),
    callBatchExecuteRpc('otAQ7b', atToken).catch(() => null),
  ]);

  if (!Array.isArray(quotaPayload) || !Array.isArray(quotaPayload[1])) {
    throw new Error('Unrecognized jSf9Qc payload');
  }

  const planId = quotaPayload[0];
  const windows = quotaPayload[1];

  let dailyUsed = 0;
  let dailyResetAt = null;
  let remaining5h = null;
  let weeklyUsed = 0;
  let weeklyResetAt = null;
  let remaining7d = null;

  for (const w of windows) {
    if (!Array.isArray(w)) continue;
    const [remaining, percent, windowType, resetArr] = w;
    if (!Number.isFinite(percent)) continue;
    const usedPct = Math.max(0, Math.min(100, Math.round(percent * 100)));
    const resetSec = resetArr?.[0]?.[0];
    const resetIso = Number.isFinite(resetSec) && resetSec > 0 ? new Date(resetSec * 1000).toISOString() : null;

    if (windowType === 1) {
      dailyUsed = usedPct;
      dailyResetAt = resetIso;
      remaining5h = Number.isFinite(remaining) ? remaining : null;
    } else if (windowType === 2) {
      weeklyUsed = usedPct;
      weeklyResetAt = resetIso;
      remaining7d = Number.isFinite(remaining) ? remaining : null;
    }
  }

  return {
    planTier: resolveGeminiPlanTier(planId, policyPayload),
    dailyUsed,
    dailyReset: formatClockLabel(dailyResetAt),
    dailyResetAt,
    remaining5h,
    weeklyUsed,
    weeklyReset: formatDateClockLabel(weeklyResetAt),
    weeklyResetAt,
    remaining7d,
    sourceMode: 'rpc',
    lastUpdated: new Date().toISOString(),
  };
}

const GEMINI_USAGE_GRAPHQL_ID = '2/dWbCvkVB0X16r9NPnxifeOAAqdCqMf0xeWvau9yPy7g=';
const GEMINI_USAGE_GRAPHQL_VARS = JSON.stringify({
  g1Request: { entrypoints: ['GEMINI_USAGE_SETTINGS_UPGRADE_BANNER'] },
  workspaceRequest: { recommendationsForSurfaceRequests: [] },
});

/**
 * Fallback zero-iframe GraphQL persisted query (`UsagePageQuery`) for Gemini Web usage.
 */
async function fetchGeminiViaGraphql() {
  const url = `${GEMINI_BASE}/_/BardChatUi/graphql/schemas/GEMINI_WEB_GRAPHQL/executeQuery?id=${encodeURIComponent(GEMINI_USAGE_GRAPHQL_ID)}&variables=${encodeURIComponent(GEMINI_USAGE_GRAPHQL_VARS)}`;
  const resp = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: { 'X-Same-Domain': '1' },
    cache: 'no-store',
  });
  if (resp.status === 401 || resp.status === 403 || (resp.redirected && resp.url.includes('accounts.google'))) {
    throw new GeminiAuthError('Not logged into Gemini');
  }
  if (!resp.ok) throw new Error(`GraphQL HTTP ${resp.status}`);
  const payload = await resp.json();
  const pools = payload?.data?.viewer?.rpcs?.getUsageInfo?.pools;
  if (!Array.isArray(pools) || pools.length === 0) {
    throw new Error('Unrecognized GraphQL usage payload');
  }

  let dailyUsed = 0;
  let dailyResetAt = null;
  let weeklyUsed = 0;
  let weeklyResetAt = null;

  for (const pool of pools) {
    if (!pool || typeof pool !== 'object') continue;
    const type = String(pool.poolType || pool.type || pool.id || '').toUpperCase();
    const rawPct = pool.percentageUsed;
    if (typeof rawPct !== 'number' || !Number.isFinite(rawPct)) continue;
    const usedPct = Math.max(0, Math.min(100, Math.round(rawPct <= 1 ? rawPct * 100 : rawPct)));
    const refreshRaw = pool.gxu?.windowRefreshesAt || pool.windowRefreshesAt || null;
    const refreshMs = refreshRaw ? Date.parse(refreshRaw) : NaN;
    const resetIso = Number.isFinite(refreshMs) ? new Date(refreshMs).toISOString() : null;

    if (type.includes('FIVE_HOURLY') || type.includes('5H')) {
      dailyUsed = usedPct;
      dailyResetAt = resetIso;
    } else if (type.includes('WEEKLY')) {
      weeklyUsed = usedPct;
      weeklyResetAt = resetIso;
    }
  }

  const tierRaw = payload?.data?.viewer?.rpcs?.getUsageInfo?.subscriptionTier;
  return {
    planTier: typeof tierRaw === 'string' && tierRaw.trim() ? tierRaw.trim() : 'AI Pro',
    dailyUsed,
    dailyReset: formatClockLabel(dailyResetAt),
    dailyResetAt,
    remaining5h: null,
    weeklyUsed,
    weeklyReset: formatDateClockLabel(weeklyResetAt),
    weeklyResetAt,
    remaining7d: null,
    sourceMode: 'graphql',
    lastUpdated: new Date().toISOString(),
  };
}

function setupFrameRules() {
  chrome.declarativeNetRequest
    .updateDynamicRules({
      removeRuleIds: [1, 2],
      addRules: [
        {
          id: 1,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            responseHeaders: [
              { header: 'x-frame-options', operation: 'remove' },
              { header: 'content-security-policy', operation: 'remove' },
            ],
          },
          condition: {
            urlFilter: '||gemini.google.com/usage*',
            resourceTypes: ['sub_frame'],
          },
        },
        {
          id: 2,
          priority: 2,
          action: { type: 'block' },
          condition: {
            initiatorDomains: [chrome.runtime.id],
            resourceTypes: ['image', 'media', 'font'],
          },
        },
      ],
    })
    .catch(() => {});
}

async function performSilentSync() {
  if (isSyncing) return;
  isSyncing = true;

  // Step 1: Try lightweight direct batchexecute RPC first (no offscreen iframe needed)
  try {
    const rpcData = await fetchGeminiViaRpc();
    await chrome.storage.local.set({ geminiUsage: rpcData, lastSyncError: '' });
    updateBadge(rpcData);
    await pushToWorker(rpcData);
    isSyncing = false;
    return;
  } catch (err) {
    if (err instanceof GeminiAuthError) {
      await chrome.storage.local.set({ lastSyncError: err.message });
      isSyncing = false;
      return;
    }
  }

  // Step 2: Try GEMINI_WEB_GRAPHQL UsagePageQuery before falling back to offscreen DOM scraper
  try {
    const gqlData = await fetchGeminiViaGraphql();
    await chrome.storage.local.set({ geminiUsage: gqlData, lastSyncError: '' });
    updateBadge(gqlData);
    await pushToWorker(gqlData);
    isSyncing = false;
    return;
  } catch (err) {
    if (err instanceof GeminiAuthError) {
      await chrome.storage.local.set({ lastSyncError: err.message });
      isSyncing = false;
      return;
    }
    // Fallback to hidden offscreen DOM scraper if both RPC & GraphQL fail
  }

  try {
    setupFrameRules();
    const offscreenUrl = chrome.runtime.getURL('offscreen.html');
    const existing = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl],
    });

    if (existing.length === 0) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['DOM_SCRAPING'],
        justification: 'Read Gemini Web usage limits and sync to Cloudflare Worker',
      });
    }

    if (syncTimeoutId) clearTimeout(syncTimeoutId);
    syncTimeoutId = setTimeout(() => cleanupSyncWindow(), SYNC_TIMEOUT_MS);

    chrome.runtime
      .sendMessage({ action: 'SCRAPE_HIDDEN', url: 'https://gemini.google.com/usage' })
      .catch(() => cleanupSyncWindow());
  } catch {
    cleanupSyncWindow();
  }
}

function cleanupSyncWindow() {
  isSyncing = false;
  if (syncTimeoutId) {
    clearTimeout(syncTimeoutId);
    syncTimeoutId = null;
  }
  chrome.offscreen.closeDocument().catch(() => {});
}

async function pushToWorker(data) {
  const { workerUrl, authToken } = await chrome.storage.local.get(['workerUrl', 'authToken']);
  if (!workerUrl || !authToken) return;

  const base = workerUrl.replace(/\/+$/, '');
  const payload = {
    version: 1,
    fetched_at: Math.floor(Date.now() / 1000),
    providers: {
      gemini_web: {
        plan_tier: data.planTier || 'AI Pro',
        quota_percent: Math.max(0, 100 - (data.dailyUsed ?? 0)),
        daily_used: data.dailyUsed ?? 0,
        daily_reset_label: data.dailyReset || 'Unknown',
        daily_reset_at: data.dailyResetAt || null,
        remaining_5h_raw: data.remaining5h ?? null,
        weekly_used: data.weeklyUsed ?? 0,
        weekly_reset_label: data.weeklyReset || 'Unknown',
        weekly_reset_at: data.weeklyResetAt || null,
        remaining_7d_raw: data.remaining7d ?? null,
        models: [
          {
            name: 'session_5h',
            remaining_percent: Math.max(0, 100 - (data.dailyUsed ?? 0)),
            reset_at: data.dailyResetAt || null,
          },
          {
            name: 'weekly',
            remaining_percent: Math.max(0, 100 - (data.weeklyUsed ?? 0)),
            reset_at: data.weeklyResetAt || null,
          },
        ],
        source: data.sourceMode === 'rpc' ? 'extension-rpc' : 'extension',
        estimated: false,
      },
    },
  };

  try {
    const res = await fetch(`${base}/api/quota/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': authToken,
      },
      body: JSON.stringify(payload),
    });
    await chrome.storage.local.set({
      lastWorkerSync: res.ok ? 'OK' : `HTTP ${res.status}`,
    });
  } catch (err) {
    await chrome.storage.local.set({ lastWorkerSync: err.message });
  }
}

function updateBadge(data) {
  if (!data || data.dailyUsed === undefined) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const remaining = Math.max(0, 100 - (data.dailyUsed ?? 0));
  chrome.action.setBadgeText({ text: `${Math.min(remaining, 99)}%` });
  const color = remaining <= 20 ? '#ef4444' : remaining <= 49 ? '#f59e0b' : '#10b981';
  chrome.action.setBadgeBackgroundColor({ color });
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'SYNC_COMPLETE') {
    chrome.storage.local.set({ geminiUsage: request.data, lastSyncError: '' }, async () => {
      updateBadge(request.data);
      await pushToWorker(request.data);
      cleanupSyncWindow();
    });
  } else if (request.action === 'SYNC_FAILED') {
    cleanupSyncWindow();
  } else if (request.action === 'START_SYNC') {
    performSilentSync();
    sendResponse({ ok: true });
  } else if (request.action === 'FORCE_TICK') {
    chrome.storage.local.get(['workerUrl', 'authToken'], async ({ workerUrl, authToken }) => {
      if (!workerUrl || !authToken) {
        sendResponse({ ok: false });
        return;
      }
      try {
        const base = workerUrl.replace(/\/+$/, '');
        const res = await fetch(`${base}/api/automation/tick`, {
          method: 'POST',
          headers: { 'X-Auth-Token': authToken },
        });
        sendResponse({ ok: res.ok, status: res.status });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Network error' });
      }
    });
    return true;
  }
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) performSilentSync();
});

function initAlarm() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: DEFAULT_INTERVAL_MIN });
  setupFrameRules();
  chrome.storage.local.get('geminiUsage', (res) => updateBadge(res.geminiUsage));
}

chrome.runtime.onStartup.addListener(initAlarm);
chrome.runtime.onInstalled.addListener(initAlarm);
