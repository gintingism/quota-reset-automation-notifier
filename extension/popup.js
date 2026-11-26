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
    btnSaveSettings: 'Simpan',
    btnSaved: 'Tersimpan',
    btnTestConn: 'Tes koneksi',
    btnTesting: 'Menguji...',
    btnWakeShort: 'Wake',
    btnWaking: '...',
    btnConfigure: 'Atur',
    openGeminiBtn: 'Buka Gemini',
    geminiLoginHint: 'Login ke Gemini Web agar kuota terbaca.',
    setupWorkerHint: 'Hubungkan Worker untuk melihat Antigravity & Copilot.',
    storageNote: 'Token disimpan lokal di chrome.storage.local',
    usedWord: 'terpakai',
    leftWord: 'sisa',
    weeklyShort: 'Mingguan',
    lastWakeLabel: 'Wake terakhir',
    resetsInPrefix: 'Reset dalam',
    resetsAtPrefix: 'Reset pukul',
    waitingSchedule: 'Menunggu jadwal reset',
    readyReset: 'Siap reset',
    readyShort: 'Siap',
    notSyncedYet: 'Belum disinkronkan',
    settingsSaved: 'Pengaturan disimpan',
    invalidUrl: 'URL Worker harus diawali https://',
    missingToken: 'Isi X-Auth-Token terlebih dahulu.',
    connOk: 'Koneksi Worker berhasil.',
    connAuthErr: 'Token ditolak (HTTP 401/403).',
    connFail: (msg) => `Gagal terhubung: ${msg}`,
    wakeOk: 'Wake terkirim',
    wakeFail: (msg) => `Wake gagal (${msg})`,
    showToken: 'Tampilkan token',
    hideToken: 'Sembunyikan token',
    calCardTitle: 'Google Calendar & Tasks',
    calCardNote: 'Hanya reset mingguan (tanpa 5h).',
    calEnabled: 'Auto-sync aktif',
    calAllDay: 'Seharian (tanpa jam)',
    btnCalSyncShort: 'Sync sekarang',
    calOAuthReady: 'OAuth siap',
    calOAuthMissing: 'Perlu OAuth',
    calSaved: 'Pengaturan Calendar disimpan.',
    calSynced: (n) => `Tersinkron (${n} item).`,
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
    btnSaveSettings: 'Save',
    btnSaved: 'Saved',
    btnTestConn: 'Test connection',
    btnTesting: 'Testing...',
    btnWakeShort: 'Wake',
    btnWaking: '...',
    btnConfigure: 'Configure',
    openGeminiBtn: 'Open Gemini',
    geminiLoginHint: 'Sign in to Gemini Web to read your quota.',
    setupWorkerHint: 'Connect your Worker to view Antigravity & Copilot.',
    storageNote: 'Token is stored locally in chrome.storage.local',
    usedWord: 'used',
    leftWord: 'left',
    weeklyShort: 'Weekly',
    lastWakeLabel: 'Last wake',
    resetsInPrefix: 'Resets in',
    resetsAtPrefix: 'Resets at',
    waitingSchedule: 'Waiting for reset schedule',
    readyReset: 'Ready to reset',
    readyShort: 'Ready',
    notSyncedYet: 'Not synced yet',
    settingsSaved: 'Settings saved',
    invalidUrl: 'Worker URL must start with https://',
    missingToken: 'Enter X-Auth-Token first.',
    connOk: 'Worker connection succeeded.',
    connAuthErr: 'Token rejected (HTTP 401/403).',
    connFail: (msg) => `Connection failed: ${msg}`,
    wakeOk: 'Wake sent',
    wakeFail: (msg) => `Wake failed (${msg})`,
    showToken: 'Show token',
    hideToken: 'Hide token',
    calCardTitle: 'Google Calendar & Tasks',
    calCardNote: 'Weekly resets only (5h excluded).',
    calEnabled: 'Auto-sync enabled',
    calAllDay: 'All-day (no time)',
    btnCalSyncShort: 'Sync now',
    calOAuthReady: 'OAuth ready',
    calOAuthMissing: 'Needs OAuth',
    calSaved: 'Calendar settings saved.',
    calSynced: (n) => `Synced (${n} items).`,
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
  settingsDirty: false,
};

function t() {
  return I18N[state.lang] || I18N.id;
}

function getTone(remainingPct) {
  if (remainingPct <= 20) return { cls: 'is-danger', color: 'var(--danger)' };
  if (remainingPct <= 49) return { cls: 'is-warn', color: 'var(--warn)' };
  return { cls: 'is-ok', color: 'var(--ok)' };
}

function clampPct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, num));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toEpochMs(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) {
    return num > 1e12 ? num : num * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
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
  const ms = toEpochMs(iso);
  if (!ms) return null;
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
  if (lower.includes('error') || lower.includes('fail') || lower.includes('gagal') || lower.includes('http') || lower.includes('not logged')) {
    dot.classList.add('is-danger');
  } else if (lower.includes('syncing') || lower.includes('menyinkron') || lower.includes('menunggu')) {
    dot.classList.add('is-warn');
  } else {
    dot.classList.add('is-ok');
  }
}

function showSettingsFeedback(message, tone = '') {
  const el = document.getElementById('settingsFeedback');
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    el.className = 'settings-feedback';
    return;
  }
  el.textContent = message;
  el.className = `settings-feedback${tone ? ` ${tone}` : ''}`;
  el.hidden = false;
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
  const agLastWakeEl = document.getElementById('agLastWake');
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
    const agAccounts =
      Array.isArray(data?.providers?.antigravity_accounts) && data.providers.antigravity_accounts.length > 0
        ? data.providers.antigravity_accounts
        : ag
          ? [{ id: 'primary', label: ag.account_label || 'Primary', ...ag }]
          : [];
    const multiAg = agAccounts.length > 1;

    agAccounts.forEach((acc) => {
      if (multiAg) {
        agRows.push(
          `<div class="account-sep"><span>${escapeText(acc.label || acc.id)}</span><span class="badge num">${escapeText(acc.plan_tier || (acc.error ? 'Error' : 'Active'))}</span></div>`,
        );
      }
      if (Array.isArray(acc?.groups)) {
        acc.groups
          .filter((g) => !/argon/i.test(g?.name || ''))
          .forEach((g) => {
            const wins = Array.isArray(g.windows) ? g.windows : [];
            const win5h = wins.find((w) => w.window_type === '5H' || /5h/i.test(w.label)) || wins[0];
            const winWeekly = wins.find((w) => w !== win5h && (w.window_type === 'WEEKLY' || /week/i.test(w.label)));
            if (!win5h) return;

            const pct = clampPct(win5h.remaining_percent);
            const tone = getTone(pct);
            const resetMs = toEpochMs(win5h.reset_at ?? win5h.reset_time_iso);

            let weeklyHtml = '';
            if (winWeekly) {
              const wPct = clampPct(winWeekly.remaining_percent);
              const wTone = getTone(wPct);
              const wResetMs = toEpochMs(winWeekly.reset_at ?? winWeekly.reset_time_iso);
              weeklyHtml = `
                <div class="overview-sub">
                  <span>${escapeText(dict.weeklyShort)} · ${wPct}%</span>
                  <span class="overview-right">
                    <span class="overview-timer num" data-reset-ms="${wResetMs}">${wResetMs ? formatCountdown(wResetMs) : dict.readyShort}</span>
                    <span class="mini-bar-wrap"><span class="mini-bar" style="display:block;width:${wPct}%;background:${wTone.color}"></span></span>
                  </span>
                </div>`;
            }

            agRows.push(`
              <div class="pool-block">
                <div class="overview-row">
                  <span class="overview-name">${escapeText(g.name)}</span>
                  <span class="overview-right">
                    <span class="overview-timer num" data-reset-ms="${resetMs}">${resetMs ? formatCountdown(resetMs) : dict.readyShort}</span>
                    <span class="mini-bar-wrap"><span class="mini-bar" style="display:block;width:${pct}%;background:${tone.color}"></span></span>
                    <span class="badge num ${tone.cls}">${pct}%</span>
                  </span>
                </div>
                ${weeklyHtml}
              </div>`);
          });
      }
    });

    if (agRows.length > 0) {
      agTierEl.textContent = ag?.plan_tier || 'Active';
      agRowsEl.innerHTML = agRows.join('');
      const lastWake = ag?.last_wake;
      if (agLastWakeEl && lastWake?.model) {
        const rel = formatRelativePast(lastWake.at);
        agLastWakeEl.textContent = `${dict.lastWakeLabel}: ${lastWake.model}${rel ? ` · ${rel}` : ''}`;
        agLastWakeEl.hidden = false;
      } else if (agLastWakeEl) {
        agLastWakeEl.hidden = true;
      }
      agCard.hidden = false;
    } else {
      agCard.hidden = true;
    }

    if (copilot && !copilot.error) {
      const pct = clampPct(copilot.percent_remaining ?? copilot.quota_percent);
      const tone = getTone(pct);
      const resetMs = toEpochMs(copilot.reset_at ?? copilot.reset_time_iso);

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
      bar.parentElement?.setAttribute('aria-valuenow', String(pct));

      const cdEl = document.getElementById('copilotCountdown');
      cdEl.dataset.resetMs = String(resetMs);
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
      const setupHint = document.getElementById('setupHint');
      const geminiAuthBanner = document.getElementById('geminiAuthBanner');

      if (!state.settingsDirty) {
        if (document.activeElement !== workerInput) workerInput.value = workerUrl || '';
        if (document.activeElement !== tokenInput) tokenInput.value = authToken || '';
      }

      if (workerUrl) {
        openWorkerBtn.href = workerUrl;
        openWorkerBtn.hidden = false;
      } else {
        openWorkerBtn.hidden = true;
      }

      if (setupHint) {
        setupHint.hidden = Boolean(workerUrl && authToken);
      }

      if (geminiAuthBanner) {
        const isAuthErr = /not logged/i.test(lastSyncError || '');
        geminiAuthBanner.hidden = !isAuthErr;
      }

      if (geminiUsage) {
        const planEl = document.getElementById('geminiPlanBadge');
        if (planEl) {
          const modeLabel =
            geminiUsage.sourceMode === 'rpc'
              ? 'RPC'
              : geminiUsage.sourceMode === 'graphql'
                ? 'GraphQL'
                : 'DOM';
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
        const exactDailyMs = toEpochMs(geminiUsage.dailyResetAt);
        state.dailyResetMs = exactDailyMs || parseGeminiLabel(geminiUsage.dailyReset, 'daily');

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
        const exactWeeklyMs = toEpochMs(geminiUsage.weeklyResetAt);
        state.weeklyResetMs = exactWeeklyMs || parseGeminiLabel(geminiUsage.weeklyReset, 'weekly');
        state.lastUpdatedIso = geminiUsage.lastUpdated || null;
      }

      if (!autoSyncTriggered) {
        autoSyncTriggered = true;
        const updatedMs = toEpochMs(geminiUsage?.lastUpdated);
        if (!updatedMs || Date.now() - updatedMs > STALE_SYNC_MS) {
          chrome.runtime.sendMessage({ action: 'START_SYNC' }, () => {
            void chrome.runtime.lastError;
          });
        }
      }

      const syncLabel = lastSyncError || lastWorkerSync || dict.notSyncedYet;
      document.getElementById('syncStatus').textContent = lastSyncError
        ? `Gemini: ${lastSyncError}`
        : `Worker: ${syncLabel}`;
      setSyncDot(lastSyncError ? `error ${lastSyncError}` : lastWorkerSync);

      tickLiveCountdowns();
      fetchWorkerOverview(workerUrl, authToken);
      loadCalendarSettingsCard(workerUrl, authToken);
    },
  );
  refreshAlarmSchedule();
}

function showCalFeedback(message, tone = '') {
  const el = document.getElementById('calFeedback');
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    el.className = 'settings-feedback';
    return;
  }
  el.textContent = message;
  el.className = `settings-feedback${tone ? ` ${tone}` : ''}`;
  el.hidden = false;
}

function readExtCalForm() {
  return {
    enabled: Boolean(document.getElementById('extCalEnabled')?.checked),
    syncCalendar: Boolean(document.getElementById('extCalCalendar')?.checked),
    syncTasks: Boolean(document.getElementById('extCalTasks')?.checked),
    includeAntigravityWeekly: Boolean(document.getElementById('extCalAgWeekly')?.checked),
    includeGeminiWebWeekly: Boolean(document.getElementById('extCalGwWeekly')?.checked),
    includeCopilotMonthly: Boolean(document.getElementById('extCalCopilot')?.checked),
    allDay: Boolean(document.getElementById('extCalAllDay')?.checked),
  };
}

let calLoaded = false;

async function loadCalendarSettingsCard(workerUrl, authToken) {
  const card = document.getElementById('calendarSettingsCard');
  if (!card) return;
  if (!workerUrl || !authToken) {
    card.hidden = true;
    return;
  }
  if (calLoaded) {
    card.hidden = false;
    return;
  }
  try {
    const base = workerUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/api/settings/calendar`, {
      headers: { 'X-Auth-Token': authToken },
    });
    if (!res.ok) {
      card.hidden = true;
      return;
    }
    const data = await res.json();
    const s = data.settings || {};
    const setCheck = (id, v) => {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(v);
    };
    setCheck('extCalEnabled', s.enabled);
    setCheck('extCalCalendar', s.syncCalendar);
    setCheck('extCalTasks', s.syncTasks);
    setCheck('extCalAgWeekly', s.includeAntigravityWeekly);
    setCheck('extCalGwWeekly', s.includeGeminiWebWeekly);
    setCheck('extCalCopilot', s.includeCopilotMonthly);
    setCheck('extCalAllDay', s.allDay);

    const badge = document.getElementById('calOAuthBadge');
    if (badge) {
      badge.textContent = data.configured ? t().calOAuthReady : t().calOAuthMissing;
      badge.className = `badge num ${data.configured ? 'is-ok' : 'is-warn'}`;
    }
    calLoaded = true;
    card.hidden = false;
  } catch {
    card.hidden = true;
  }
}

function sendRuntimeMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(resp || { ok: true });
    });
  });
}

function validateWorkerInputs(workerUrl, authToken) {
  const dict = t();
  if (workerUrl) {
    try {
      const parsed = new URL(workerUrl);
      if (parsed.protocol !== 'https:') return dict.invalidUrl;
    } catch {
      return dict.invalidUrl;
    }
  }
  if (workerUrl && !authToken) return dict.missingToken;
  return null;
}

document.querySelectorAll('.lang-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const nextLang = btn.dataset.lang === 'en' ? 'en' : 'id';
    chrome.storage.local.set({ uiLang: nextLang }, render);
  });
});

const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
tabButtons.forEach((btn, idx) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const nextIdx = (idx + (e.key === 'ArrowRight' ? 1 : -1) + tabButtons.length) % tabButtons.length;
    tabButtons[nextIdx].focus();
    switchTab(tabButtons[nextIdx].dataset.tab);
  });
});

document.getElementById('goSettingsBtn')?.addEventListener('click', () => {
  switchTab('settings');
  document.getElementById('workerUrl')?.focus();
});

document.getElementById('toggleTokenBtn').addEventListener('click', () => {
  const input = document.getElementById('authToken');
  const btn = document.getElementById('toggleTokenBtn');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.setAttribute('aria-pressed', String(show));
  btn.setAttribute('aria-label', show ? t().hideToken : t().showToken);
  btn.innerHTML = `<i data-lucide="${show ? 'eye-off' : 'eye'}" aria-hidden="true"></i>`;
  if (window.lucide) window.lucide.createIcons({ root: btn });
});

['workerUrl', 'authToken'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', () => {
      state.settingsDirty = true;
      showSettingsFeedback('');
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('saveBtn').click();
    });
  }
});

document.getElementById('testConnBtn')?.addEventListener('click', async () => {
  const workerUrl = document.getElementById('workerUrl').value.trim().replace(/\/+$/, '');
  const authToken = document.getElementById('authToken').value.trim();
  const dict = t();

  const err = validateWorkerInputs(workerUrl, authToken) || (!workerUrl ? dict.invalidUrl : null);
  if (err) {
    showSettingsFeedback(err, 'is-danger');
    return;
  }

  const btn = document.getElementById('testConnBtn');
  const label = document.getElementById('testConnLabel');
  btn.disabled = true;
  label.textContent = dict.btnTesting;

  try {
    if (!workerUrl.endsWith('.workers.dev') && chrome.permissions?.request) {
      await chrome.permissions.request({ origins: [`${new URL(workerUrl).origin}/*`] }).catch(() => {});
    }
    const res = await fetch(`${workerUrl}/api/quota/latest`, {
      headers: { 'X-Auth-Token': authToken },
    });
    if (res.ok) {
      showSettingsFeedback(dict.connOk, 'is-ok');
    } else if (res.status === 401 || res.status === 403) {
      showSettingsFeedback(dict.connAuthErr, 'is-danger');
    } else {
      showSettingsFeedback(dict.connFail(`HTTP ${res.status}`), 'is-danger');
    }
  } catch (e) {
    showSettingsFeedback(dict.connFail(e?.message || 'Network error'), 'is-danger');
  } finally {
    btn.disabled = false;
    label.textContent = t().btnTestConn;
  }
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const workerUrl = document.getElementById('workerUrl').value.trim().replace(/\/+$/, '');
  const authToken = document.getElementById('authToken').value.trim();
  const label = document.getElementById('saveBtnLabel');
  const dict = t();

  const err = validateWorkerInputs(workerUrl, authToken);
  if (err) {
    showSettingsFeedback(err, 'is-danger');
    return;
  }

  if (workerUrl && !workerUrl.endsWith('.workers.dev') && chrome.permissions?.request) {
    try {
      const origin = `${new URL(workerUrl).origin}/*`;
      await chrome.permissions.request({ origins: [origin] });
    } catch {
      // Ignore if invalid URL or permission declined
    }
  }

  chrome.storage.local.set({ workerUrl, authToken }, () => {
    state.settingsDirty = false;
    showSettingsFeedback(dict.settingsSaved, 'is-ok');
    label.textContent = dict.btnSaved;
    document.getElementById('syncStatus').textContent = `Worker: ${dict.settingsSaved}`;
    setSyncDot('ok');
    setTimeout(() => {
      label.textContent = t().btnSaveSettings;
      showSettingsFeedback('');
      switchTab('status');
      render();
    }, 650);
  });
});

document.getElementById('extCalSaveBtn')?.addEventListener('click', async () => {
  const { workerUrl, authToken } = await chrome.storage.local.get(['workerUrl', 'authToken']);
  if (!workerUrl || !authToken) return;
  const btn = document.getElementById('extCalSaveBtn');
  btn.disabled = true;
  showCalFeedback('');
  try {
    const base = workerUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/api/settings/calendar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': authToken },
      body: JSON.stringify(readExtCalForm()),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const syncedCount = data?.sync?.synced?.length ?? 0;
      const suffix = syncedCount > 0 ? ` (${syncedCount})` : '';
      showCalFeedback(`${t().calSaved}${suffix}`, 'is-ok');
    } else {
      showCalFeedback(t().connFail(`HTTP ${res.status}`), 'is-danger');
    }
  } catch (e) {
    showCalFeedback(t().connFail(e?.message || 'Network error'), 'is-danger');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('extCalSyncBtn')?.addEventListener('click', async () => {
  const { workerUrl, authToken } = await chrome.storage.local.get(['workerUrl', 'authToken']);
  if (!workerUrl || !authToken) return;
  const btn = document.getElementById('extCalSyncBtn');
  btn.disabled = true;
  showCalFeedback('');
  try {
    const base = workerUrl.replace(/\/+$/, '');
    const res = await fetch(`${base}/api/calendar/sync`, {
      method: 'POST',
      headers: { 'X-Auth-Token': authToken },
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      showCalFeedback(t().calSynced((data.synced || []).length), 'is-ok');
    } else {
      const msg = (data.errors && data.errors[0]) || data.error || `HTTP ${res.status}`;
      showCalFeedback(t().connFail(msg), 'is-danger');
    }
  } catch (e) {
    showCalFeedback(t().connFail(e?.message || 'Network error'), 'is-danger');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('wakeBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('wakeBtn');
  const span = btn.querySelector('span');
  const dict = t();
  btn.disabled = true;
  if (span) span.textContent = dict.btnWaking;

  const res = await sendRuntimeMessage({ action: 'FORCE_WAKE' });
  if (res?.ok) {
    document.getElementById('syncStatus').textContent = `Worker: ${dict.wakeOk}`;
    setSyncDot('ok');
  } else {
    const code = res?.status ? `HTTP ${res.status}` : res?.error || 'error';
    document.getElementById('syncStatus').textContent = `Worker: ${dict.wakeFail(code)}`;
    setSyncDot('error');
  }

  btn.disabled = false;
  if (span) span.textContent = t().btnWakeShort;
  render();
});

document.getElementById('syncBtn').addEventListener('click', async () => {
  const syncBtn = document.getElementById('syncBtn');
  const label = document.getElementById('syncBtnLabel');
  const icon = syncBtn.querySelector('svg, i');
  const dict = t();

  syncBtn.disabled = true;
  label.textContent = dict.btnSyncing;
  if (icon) icon.classList.add('spin');

  document.getElementById('syncStatus').textContent = `Worker: ${dict.btnSyncing}`;
  setSyncDot('syncing');

  const [syncRes, tickRes] = await Promise.all([
    sendRuntimeMessage({ action: 'START_SYNC' }),
    sendRuntimeMessage({ action: 'FORCE_TICK' }),
  ]);

  if (tickRes && !tickRes.ok && tickRes.status) {
    document.getElementById('syncStatus').textContent = `Worker: HTTP ${tickRes.status}`;
    setSyncDot(`error HTTP ${tickRes.status}`);
  } else if (syncRes && !syncRes.ok && syncRes.error) {
    document.getElementById('syncStatus').textContent = `Gemini: ${syncRes.error}`;
    setSyncDot(`error ${syncRes.error}`);
  }

  syncBtn.disabled = false;
  label.textContent = t().btnSyncNow;
  const currentIcon = syncBtn.querySelector('svg, i');
  if (currentIcon) currentIcon.classList.remove('spin');
  render();
});

if (window.lucide) {
  window.lucide.createIcons();
}

chrome.storage.onChanged.addListener(render);
setInterval(tickLiveCountdowns, 1000);
render();
