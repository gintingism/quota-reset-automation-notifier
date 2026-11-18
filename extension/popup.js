const RING_CIRCUMFERENCE = 2 * Math.PI * 28;

const I18N = {
  id: {
    tabStatus: 'Status',
    tabSettings: 'Pengaturan',
    openDashboard: 'Dashboard',
    unitLeft: 'sisa',
    session5hTitle: 'Sesi 5h',
    weeklyTitle: 'Mingguan',
    monthlyResetLabel: 'Reset bulanan',
    btnSyncNow: 'Sinkronkan sekarang',
    btnSyncing: 'Menyinkronkan...',
    btnSaveSettings: 'Simpan pengaturan',
    btnSaved: 'Tersimpan',
    storageNote: 'Token disimpan lokal di chrome.storage.local',
    usedWord: 'terpakai',
    leftWord: 'sisa',
    resetsInPrefix: 'Reset dalam',
    resetsAtPrefix: 'Reset pukul',
    waitingSchedule: 'Menunggu jadwal reset',
    readyReset: 'Siap reset',
    readyShort: 'Siap',
    notSyncedYet: 'Belum disinkronkan',
    settingsSaved: 'Pengaturan disimpan',
    justNow: 'baru saja',
    minAgo: (m) => `${m}m lalu`,
    hrMinAgo: (h, m) => `${h}j ${m}m lalu`,
    readPrefix: 'Dibaca',
    autoSyncIn: (m, s) => `Auto-sync ${m}m ${s}d`,
    autoSyncActive: 'Auto-sync 15m aktif',
    copilotCreditsLeft: (rem, ent) => `${rem} / ${ent} AI credits sisa`,
    copilotCreditsUsed: (used) => `${used} terpakai`,
    paceSafe: (elapsed) => `Laju aman (${elapsed}% waktu berjalan)`,
    paceDepletes: (dur) => `Boros · habis ~${dur} lagi`,
  },
  en: {
    tabStatus: 'Status',
    tabSettings: 'Settings',
    openDashboard: 'Dashboard',
    unitLeft: 'left',
    session5hTitle: '5h Session',
    weeklyTitle: 'Weekly',
    monthlyResetLabel: 'Monthly reset',
    btnSyncNow: 'Sync now',
    btnSyncing: 'Syncing...',
    btnSaveSettings: 'Save settings',
    btnSaved: 'Saved',
    storageNote: 'Token is stored locally in chrome.storage.local',
    usedWord: 'used',
    leftWord: 'left',
    resetsInPrefix: 'Resets in',
    resetsAtPrefix: 'Resets at',
    waitingSchedule: 'Waiting for reset schedule',
    readyReset: 'Ready to reset',
    readyShort: 'Ready',
    notSyncedYet: 'Not synced yet',
    settingsSaved: 'Settings saved',
    justNow: 'just now',
    minAgo: (m) => `${m}m ago`,
    hrMinAgo: (h, m) => `${h}h ${m}m ago`,
    readPrefix: 'Read',
    autoSyncIn: (m, s) => `Auto-sync ${m}m ${s}s`,
    autoSyncActive: '15m auto-sync active',
    copilotCreditsLeft: (rem, ent) => `${rem} / ${ent} AI credits left`,
    copilotCreditsUsed: (used) => `${used} used`,
    paceSafe: (elapsed) => `On track (${elapsed}% window elapsed)`,
    paceDepletes: (dur) => `Over pace · depletes in ~${dur}`,
  },
};

const state = {
  lang: 'id',
  dailyUsed: 0,
  weeklyUsed: 0,
  dailyResetMs: null,
  weeklyResetMs: null,
  nextAlarmMs: null,
  lastUpdatedIso: null,
};

function t() {
  return I18N[state.lang] || I18N.id;
}

function getTone(remainingPct) {
  if (remainingPct <= 20) return { cls: 'is-danger', color: '#ef4444' };
  if (remainingPct <= 49) return { cls: 'is-warn', color: '#f59e0b' };
  return { cls: 'is-ok', color: '#10b981' };
}

function clampPct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, num));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatCountdown(targetMs) {
  if (!targetMs || !Number.isFinite(targetMs)) return '—';
  const diff = Math.max(0, Math.floor((targetMs - Date.now()) / 1000));
  if (diff <= 0) return t().readyReset;
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  const dayUnit = state.lang === 'en' ? 'd' : 'h';
  return d > 0 ? `${d}${dayUnit} ${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

function formatRelativePast(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return t().justNow;
  const min = Math.floor(sec / 60);
  if (min < 60) return t().minAgo(min);
  const hr = Math.floor(min / 60);
  return t().hrMinAgo(hr, min % 60);
}

function parseGeminiLabel(label, kind) {
  if (!label || label === 'Unknown' || label === '—') return null;
  const now = new Date();
  const months = {
    jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5,
    jul: 6, agu: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11,
  };

  const timeMatch = label.match(/(\d{1,2})[.:](\d{2})(?:\s*(AM|PM))?/i);
  if (!timeMatch) return null;
  let hr = parseInt(timeMatch[1], 10);
  const min = parseInt(timeMatch[2], 10);
  const ap = timeMatch[3] ? timeMatch[3].toUpperCase() : null;
  if (ap === 'PM' && hr < 12) hr += 12;
  if (ap === 'AM' && hr === 12) hr = 0;

  if (kind === 'weekly') {
    const dateMatch = label.match(/(\d{1,2})\s+([A-Za-z]+)|([A-Za-z]+)\s+(\d{1,2})/);
    if (dateMatch) {
      const day = parseInt(dateMatch[1] || dateMatch[4], 10);
      const monKey = (dateMatch[2] || dateMatch[3]).slice(0, 3).toLowerCase();
      const mon = months[monKey];
      if (mon !== undefined) {
        const target = new Date(now.getFullYear(), mon, day, hr, min, 0, 0);
        if (target.getTime() < now.getTime() - 86400000) {
          target.setFullYear(now.getFullYear() + 1);
        }
        return target.getTime();
      }
    }
  }

  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hr, min, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

function setSyncDot(statusText) {
  const dot = document.getElementById('syncDot');
  dot.classList.remove('is-ok', 'is-warn', 'is-danger');
  const lower = String(statusText || '').toLowerCase();
  if (!statusText || statusText === '—') return;
  if (lower.includes('error') || lower.includes('fail') || lower.includes('gagal') || lower.includes('http')) {
    dot.classList.add('is-danger');
  } else if (lower.includes('syncing') || lower.includes('menunggu')) {
    dot.classList.add('is-warn');
  } else {
    dot.classList.add('is-ok');
  }
}

function applyStaticTranslations() {
  const dict = t();
  document.documentElement.lang = state.lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (typeof dict[key] === 'string') {
      el.textContent = dict[key];
    }
  });
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    const active = btn.dataset.lang === state.lang;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

function switchTab(tabName) {
  const statusPanel = document.getElementById('panel-status');
  const settingsPanel = document.getElementById('panel-settings');
  const buttons = document.querySelectorAll('.tab-btn');

  buttons.forEach((btn) => {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  statusPanel.hidden = tabName !== 'status';
  settingsPanel.hidden = tabName !== 'settings';
}

function formatShortDuration(ms) {
  const totalMin = Math.max(1, Math.round(ms / 60000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const dayUnit = state.lang === 'en' ? 'd' : 'h';
  const hrUnit = state.lang === 'en' ? 'h' : 'j';
  if (d > 0) return `${d}${dayUnit} ${h}${hrUnit}`;
  if (h > 0) return `${h}${hrUnit} ${m}m`;
  return `${m}m`;
}

function formatBurnForecast(usedPct, resetMs, windowHours) {
  if (!Number.isFinite(usedPct) || !resetMs || resetMs <= Date.now()) return '—';
  const totalMs = windowHours * 3600 * 1000;
  const remainingMs = Math.max(0, resetMs - Date.now());
  if (remainingMs > totalMs) return t().paceSafe(0);
  const elapsedMs = Math.max(0, totalMs - remainingMs);
  const elapsedPct = Math.min(100, Math.round((elapsedMs / totalMs) * 100));

  if (usedPct <= 0 || elapsedMs < 3 * 60 * 1000) {
    return t().paceSafe(elapsedPct);
  }
  const ratePerMs = usedPct / elapsedMs;
  const depletionMs = (100 - usedPct) / ratePerMs;
  if (depletionMs < remainingMs) {
    return t().paceDepletes(formatShortDuration(depletionMs));
  }
  return t().paceSafe(elapsedPct);
}

function tickLiveCountdowns() {
  const dict = t();
  const dailyEl = document.getElementById('dailyCountdown');
  if (dailyEl) {
    dailyEl.textContent = state.dailyResetMs
      ? `${dict.resetsInPrefix} ${formatCountdown(state.dailyResetMs)}`
      : dict.waitingSchedule;
  }

  const dailyPaceEl = document.getElementById('dailyPace');
  if (dailyPaceEl) {
    dailyPaceEl.textContent = formatBurnForecast(state.dailyUsed, state.dailyResetMs, 5);
  }

  const weeklyEl = document.getElementById('weeklyCountdown');
  if (weeklyEl) {
    weeklyEl.textContent = state.weeklyResetMs ? formatCountdown(state.weeklyResetMs) : '—';
  }

  const weeklyPaceEl = document.getElementById('weeklyPace');
  if (weeklyPaceEl) {
    weeklyPaceEl.textContent = formatBurnForecast(state.weeklyUsed, state.weeklyResetMs, 168);
  }

  document.querySelectorAll('.overview-timer[data-reset-ms]').forEach((el) => {
    const ms = Number(el.dataset.resetMs);
    el.textContent = ms > 0 ? formatCountdown(ms) : dict.readyShort;
  });

  const footer = document.getElementById('lastScraped');
  if (footer) {
    const parts = [];
    const relPast = formatRelativePast(state.lastUpdatedIso);
    if (relPast) parts.push(`${dict.readPrefix} ${relPast}`);
    if (state.nextAlarmMs && state.nextAlarmMs > Date.now()) {
      const remSec = Math.floor((state.nextAlarmMs - Date.now()) / 1000);
      parts.push(dict.autoSyncIn(Math.floor(remSec / 60), pad2(remSec % 60)));
    } else {
      parts.push(dict.autoSyncActive);
    }
    footer.textContent = parts.join(' · ');
  }
}

function escapeText(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

async function fetchWorkerOverview(workerUrl, authToken) {
  const agCard = document.getElementById('antigravityCard');
  const agRowsEl = document.getElementById('agRows');
  const agTierEl = document.getElementById('agTier');
  const copilotCard = document.getElementById('copilotCard');

  if (!workerUrl || !authToken || !agCard || !copilotCard) {
    if (agCard) agCard.hidden = true;
    if (copilotCard) copilotCard.hidden = true;
    return;
  }

  try {
    const base = workerUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/api/quota/latest`, {
      headers: { 'X-Auth-Token': authToken },
    });
    if (!res.ok) {
      agCard.hidden = true;
      copilotCard.hidden = true;
      return;
    }
    const data = await res.json();
    const ag = data?.providers?.antigravity;
    const copilot = data?.providers?.github_copilot;
    const dict = t();

    const agRows = [];
    if (Array.isArray(ag?.groups)) {
      ag.groups.forEach((g) => {
        const win5h = (g.windows || []).find((w) => /5h/i.test(w.label)) || g.windows?.[0];
        if (!win5h) return;
        const pct = clampPct(win5h.remaining_percent);
        const tone = getTone(pct);
        const resetMs = win5h.reset_at ? Date.parse(win5h.reset_at) : 0;
        agRows.push(`
          <div class="overview-row">
            <span class="overview-name">${escapeText(g.name)}</span>
            <span class="overview-right">
              <span class="overview-timer num" data-reset-ms="${Number.isFinite(resetMs) ? resetMs : 0}">${resetMs ? formatCountdown(resetMs) : dict.readyShort}</span>
              <span class="mini-bar-wrap"><span class="mini-bar" style="display:block;width:${pct}%;background:${tone.color}"></span></span>
              <span class="badge num ${tone.cls}">${pct}%</span>
            </span>
          </div>`);
      });
    }

    if (agRows.length > 0) {
      agTierEl.textContent = ag?.plan_tier || 'Active';
      agRowsEl.innerHTML = agRows.join('');
      agCard.hidden = false;
    } else {
      agCard.hidden = true;
    }

    if (copilot && !copilot.error) {
      const pct = clampPct(copilot.percent_remaining ?? copilot.quota_percent);
      const tone = getTone(pct);
      const resetMs = copilot.reset_at ? Date.parse(copilot.reset_at) : 0;

      document.getElementById('copilotPlan').textContent = copilot.plan_tier || 'individual';
      const creditsText =
        copilot.credits_remaining !== undefined && copilot.credits_entitlement !== undefined
          ? dict.copilotCreditsLeft(copilot.credits_remaining, copilot.credits_entitlement)
          : dict.copilotCreditsUsed(copilot.credits_used ?? 0);
      document.getElementById('copilotCredits').textContent = creditsText;

      const pctBadge = document.getElementById('copilotPctBadge');
      pctBadge.textContent = `${pct}% ${dict.leftWord}`;
      pctBadge.className = `badge num ${tone.cls}`;

      const bar = document.getElementById('copilotBar');
      bar.style.width = `${pct}%`;
      bar.style.backgroundColor = tone.color;

      const cdEl = document.getElementById('copilotCountdown');
      cdEl.dataset.resetMs = Number.isFinite(resetMs) ? String(resetMs) : '0';
      cdEl.textContent = resetMs ? formatCountdown(resetMs) : '—';

      copilotCard.hidden = false;
    } else {
      copilotCard.hidden = true;
    }

    tickLiveCountdowns();
  } catch {
    agCard.hidden = true;
    copilotCard.hidden = true;
  }
}

function refreshAlarmSchedule() {
  if (!chrome.alarms?.get) return;
  chrome.alarms.get('gemini-web-sync', (alarm) => {
    state.nextAlarmMs = alarm?.scheduledTime || null;
    tickLiveCountdowns();
  });
}

let autoSyncTriggered = false;
const STALE_SYNC_MS = 3 * 60 * 1000;

function render() {
  chrome.storage.local.get(
    ['geminiUsage', 'workerUrl', 'authToken', 'lastWorkerSync', 'lastSyncError', 'uiLang'],
    ({ geminiUsage, workerUrl, authToken, lastWorkerSync, lastSyncError, uiLang }) => {
      state.lang = uiLang === 'en' ? 'en' : 'id';
      applyStaticTranslations();
      const dict = t();

      const workerInput = document.getElementById('workerUrl');
      const tokenInput = document.getElementById('authToken');
      const openWorkerBtn = document.getElementById('openWorkerBtn');

      if (workerUrl) {
        workerInput.value = workerUrl;
        openWorkerBtn.href = workerUrl;
        openWorkerBtn.hidden = false;
      } else {
        openWorkerBtn.hidden = true;
      }
      if (authToken) tokenInput.value = authToken;

      if (geminiUsage) {
        const planEl = document.getElementById('geminiPlanBadge');
        if (planEl) {
          const modeLabel = geminiUsage.sourceMode === 'rpc' ? 'RPC' : 'DOM';
          planEl.textContent = geminiUsage.planTier
            ? `${geminiUsage.planTier} · ${modeLabel} · gemini.google.com`
            : 'gemini.google.com/usage';
        }

        const dailyUsed = clampPct(geminiUsage.dailyUsed);
        state.dailyUsed = dailyUsed;
        const dailyRemaining = 100 - dailyUsed;
        const dailyTone = getTone(dailyRemaining);

        document.getElementById('daily').textContent = `${dailyRemaining}%`;
        const dailyBadge = document.getElementById('dailyBadge');
        dailyBadge.textContent = `${dailyUsed}% ${dict.usedWord}`;
        dailyBadge.className = `badge num ${dailyTone.cls}`;

        const dailyRing = document.getElementById('dailyRing');
        const offset = RING_CIRCUMFERENCE * (1 - dailyRemaining / 100);
        dailyRing.style.strokeDasharray = `${RING_CIRCUMFERENCE.toFixed(2)}`;
        dailyRing.style.strokeDashoffset = `${offset.toFixed(2)}`;
        dailyRing.style.stroke = dailyTone.color;

        document.getElementById('dailyReset').textContent = `${dict.resetsAtPrefix} ${geminiUsage.dailyReset || '—'}`;
        const exactDailyMs = geminiUsage.dailyResetAt ? Date.parse(geminiUsage.dailyResetAt) : NaN;
        state.dailyResetMs = Number.isFinite(exactDailyMs)
          ? exactDailyMs
          : parseGeminiLabel(geminiUsage.dailyReset, 'daily');

        const weeklyUsed = clampPct(geminiUsage.weeklyUsed);
        state.weeklyUsed = weeklyUsed;
        const weeklyRemaining = 100 - weeklyUsed;
        const weeklyTone = getTone(weeklyRemaining);

        document.getElementById('weekly').textContent = `${weeklyRemaining}% ${dict.leftWord} (${weeklyUsed}% ${dict.usedWord})`;
        const weeklyBar = document.getElementById('weeklyBar');
        weeklyBar.style.width = `${weeklyRemaining}%`;
        weeklyBar.style.backgroundColor = weeklyTone.color;
        weeklyBar.parentElement?.setAttribute('aria-valuenow', String(weeklyRemaining));

        document.getElementById('weeklyReset').textContent = `${geminiUsage.weeklyReset || '—'}`;
        const exactWeeklyMs = geminiUsage.weeklyResetAt ? Date.parse(geminiUsage.weeklyResetAt) : NaN;
        state.weeklyResetMs = Number.isFinite(exactWeeklyMs)
          ? exactWeeklyMs
          : parseGeminiLabel(geminiUsage.weeklyReset, 'weekly');
        state.lastUpdatedIso = geminiUsage.lastUpdated || null;
      }

      if (!autoSyncTriggered) {
        autoSyncTriggered = true;
        const updatedMs = geminiUsage?.lastUpdated ? Date.parse(geminiUsage.lastUpdated) : 0;
        if (!updatedMs || Date.now() - updatedMs > STALE_SYNC_MS) {
          chrome.runtime.sendMessage({ action: 'START_SYNC' });
        }
      }

      const syncLabel = lastSyncError || lastWorkerSync || dict.notSyncedYet;
      document.getElementById('syncStatus').textContent = lastSyncError
        ? `Gemini: ${lastSyncError}`
        : `Worker: ${syncLabel}`;
      setSyncDot(lastSyncError ? `error ${lastSyncError}` : lastWorkerSync);

      tickLiveCountdowns();
      fetchWorkerOverview(workerUrl, authToken);
    },
  );
  refreshAlarmSchedule();
}

document.querySelectorAll('.lang-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const nextLang = btn.dataset.lang === 'en' ? 'en' : 'id';
    chrome.storage.local.set({ uiLang: nextLang }, render);
  });
});

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.getElementById('toggleTokenBtn').addEventListener('click', () => {
  const input = document.getElementById('authToken');
  const btn = document.getElementById('toggleTokenBtn');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.innerHTML = `<i data-lucide="${show ? 'eye-off' : 'eye'}"></i>`;
  if (window.lucide) window.lucide.createIcons({ root: btn });
});

['workerUrl', 'authToken'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('saveBtn').click();
    });
  }
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const workerUrl = document.getElementById('workerUrl').value.trim().replace(/\/+$/, '');
  const authToken = document.getElementById('authToken').value.trim();
  const label = document.getElementById('saveBtnLabel');
  const dict = t();

  if (workerUrl && !workerUrl.endsWith('.workers.dev') && chrome.permissions?.request) {
    try {
      const origin = `${new URL(workerUrl).origin}/*`;
      await chrome.permissions.request({ origins: [origin] });
    } catch {
      // Ignore if invalid URL or permission declined
    }
  }

  chrome.storage.local.set({ workerUrl, authToken }, () => {
    label.textContent = dict.btnSaved;
    document.getElementById('syncStatus').textContent = `Worker: ${dict.settingsSaved}`;
    setSyncDot('ok');
    setTimeout(() => {
      label.textContent = t().btnSaveSettings;
      switchTab('status');
      render();
    }, 700);
  });
});

document.getElementById('syncBtn').addEventListener('click', () => {
  const syncBtn = document.getElementById('syncBtn');
  const label = document.getElementById('syncBtnLabel');
  const icon = syncBtn.querySelector('svg, i');
  const dict = t();

  syncBtn.disabled = true;
  label.textContent = dict.btnSyncing;
  if (icon) icon.classList.add('spin');

  document.getElementById('syncStatus').textContent = `Worker: ${dict.btnSyncing}`;
  setSyncDot('syncing');
  chrome.runtime.sendMessage({ action: 'START_SYNC' });
  chrome.runtime.sendMessage({ action: 'FORCE_TICK' }, () => {
    void chrome.runtime.lastError;
  });

  setTimeout(() => {
    syncBtn.disabled = false;
    label.textContent = t().btnSyncNow;
    const currentIcon = syncBtn.querySelector('svg, i');
    if (currentIcon) currentIcon.classList.remove('spin');
    render();
  }, 3500);
});

if (window.lucide) {
  window.lucide.createIcons();
}

chrome.storage.onChanged.addListener(render);
setInterval(tickLiveCountdowns, 1000);
render();
