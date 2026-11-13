const ALARM_NAME = 'gemini-web-sync';
const DEFAULT_INTERVAL_MIN = 15;
const SYNC_TIMEOUT_MS = 15000;

let syncTimeoutId = null;
let isSyncing = false;

function setupFrameRules() {
  chrome.declarativeNetRequest
    .updateDynamicRules({
      removeRuleIds: [1],
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
      ],
    })
    .catch(() => {});
}

async function performSilentSync() {
  if (isSyncing) return;
  isSyncing = true;

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
        quota_percent: Math.max(0, 100 - (data.dailyUsed ?? 0)),
        daily_used: data.dailyUsed ?? 0,
        daily_reset_label: data.dailyReset || 'Unknown',
        weekly_used: data.weeklyUsed ?? 0,
        weekly_reset_label: data.weeklyReset || 'Unknown',
        models: [
          { name: 'session_5h', remaining_percent: Math.max(0, 100 - (data.dailyUsed ?? 0)) },
          { name: 'weekly', remaining_percent: Math.max(0, 100 - (data.weeklyUsed ?? 0)) },
        ],
        source: 'extension',
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
  chrome.action.setBadgeText({ text: `${Math.min(data.dailyUsed, 99)}%` });
  const color = data.dailyUsed >= 85 ? '#ef4444' : data.dailyUsed >= 60 ? '#f59e0b' : '#10b981';
  chrome.action.setBadgeBackgroundColor({ color });
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'SYNC_COMPLETE') {
    chrome.storage.local.set({ geminiUsage: request.data }, async () => {
      updateBadge(request.data);
      await pushToWorker(request.data);
      cleanupSyncWindow();
    });
  } else if (request.action === 'SYNC_FAILED') {
    cleanupSyncWindow();
  } else if (request.action === 'START_SYNC') {
    performSilentSync();
    sendResponse({ ok: true });
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
