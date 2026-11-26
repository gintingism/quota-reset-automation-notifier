/**
 * Lightweight HTML dashboard rendered from the latest KV snapshot (no secrets exposed).
 */

import { computeBurnRateForecast } from './gemini_rpc.js';
import { computeSeriesBurnRate, renderSparklineSvg } from './history.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toEpochMs(isoOrEpoch) {
  if (!isoOrEpoch) return null;
  const ms = typeof isoOrEpoch === 'number' ? isoOrEpoch * 1000 : Date.parse(isoOrEpoch);
  return Number.isFinite(ms) ? ms : null;
}

function formatReset(isoOrEpoch, offsetHours = 7) {
  const ms = toEpochMs(isoOrEpoch);
  if (ms === null) return '—';
  const diffMin = Math.max(0, Math.round((ms - Date.now()) / 60000));
  const d = Math.floor(diffMin / 1440);
  const h = Math.floor((diffMin % 1440) / 60);
  const m = diffMin % 60;
  const rel = d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
  const local = new Date(ms + offsetHours * 3600 * 1000).toISOString().replace('T', ' ').slice(5, 16);
  return `${rel} (${local} UTC+${offsetHours})`;
}

function formatLocalTime(ms, offsetHours = 7) {
  if (!ms) return '—';
  return new Date(ms + offsetHours * 3600 * 1000).toISOString().replace('T', ' ').slice(5, 16) + ` UTC+${offsetHours}`;
}

function barColor(pct) {
  if (pct <= 20) return '#ef4444';
  if (pct <= 49) return '#f59e0b';
  return '#10b981';
}

function toneClass(pct) {
  if (pct <= 20) return 'is-danger';
  if (pct <= 49) return 'is-warn';
  return 'is-ok';
}

const SVG_AG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2L3.5 20.5h3.8l1.9-4.3h5.6l1.9 4.3h3.8L12 2zm-1.6 10.8L12 8.9l1.6 3.9h-3.2zM12 15.8a6.5 6.5 0 0 1-5.6-3.2l-1.5 1a8.2 8.2 0 0 0 14.2 0l-1.5-1A6.5 6.5 0 0 1 12 15.8z"/></svg>`;
const SVG_GH = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12z"/></svg>`;
const SVG_GEMINI = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81z"/></svg>`;

export function renderDashboardHtml(latest, wakeState, offsetHours = 7, calendarInfo = null, history = []) {
  const ag = latest?.providers?.antigravity;
  const agAccounts =
    Array.isArray(latest?.providers?.antigravity_accounts) && latest.providers.antigravity_accounts.length > 0
      ? latest.providers.antigravity_accounts
      : ag
        ? [{ id: 'primary', label: ag.account_label || 'Primary', ...ag }]
        : [];
  const multiAccount = agAccounts.length > 1;
  const copilot = latest?.providers?.github_copilot;
  const geminiWeb = latest?.providers?.gemini_web;
  const groups = Array.isArray(ag?.groups) ? ag.groups : [];
  const models = Array.isArray(ag?.models) ? ag.models : [];
  const historyPoints = Array.isArray(history) ? history : [];
  const calConfigured = Boolean(calendarInfo?.configured);
  const calCfg = {
    enabled: false,
    syncCalendar: true,
    syncTasks: false,
    includeAntigravityWeekly: true,
    includeGeminiWebWeekly: true,
    includeCopilotMonthly: false,
    allDay: false,
    calendarId: 'primary',
    reminderMinutes: 15,
    ...(calendarInfo?.settings || {}),
  };

  const fetchedMs = latest?.fetched_at ? latest.fetched_at * 1000 : null;
  const updatedAt = fetchedMs
    ? new Date(fetchedMs + offsetHours * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) + ` UTC+${offsetHours}`
    : '';

  const agResetMs = toEpochMs(ag?.rolling_reset_at);

  const wakeDecisions = ag?.wake_decisions || {};
  const renderGroupCardsFor = (accGroups, accDecisions) =>
    (accGroups || [])
      .map((g) => {
        const lowerName = (g.name || '').toLowerCase();
        const poolKey = lowerName.includes('gemini') ? 'gemini' : 'claude-gpt';
        const decision = (accDecisions || {})[poolKey];
        const decisionI18nKey = decision?.reason ? `wake_${decision.reason.replace(/[^a-z0-9_]/gi, '_')}` : '';
        const decisionBadge = decision
          ? `<span class="badge mono ${decision.shouldTrigger ? 'is-ok' : decision.reason?.startsWith('blocked:') ? 'is-danger' : ''}" data-i18n="${escapeHtml(decisionI18nKey)}" title="${escapeHtml([decision.reason, decision.modelId].filter(Boolean).join(' · '))}">${escapeHtml(decision.reason || '')}</span>`
          : '';

        const windowsHtml = (g.windows || [])
          .map((w) => {
            const pct = w.remaining_percent ?? 0;
            const resetMs = toEpochMs(w.reset_at);
            return `
            <div class="win-row">
              <div class="win-info">
                <div class="win-label">${escapeHtml(w.label)}</div>
                <div class="muted num">
                  ${
                    resetMs
                      ? `<span data-i18n="resetsIn">Reset dalam</span> <span class="countdown" data-reset-ms="${resetMs}">${escapeHtml(formatReset(w.reset_at, offsetHours).split(' (')[0])}</span> · ${escapeHtml(formatLocalTime(resetMs, offsetHours))}`
                      : `<span data-i18n="readyFull">Siap / 100% penuh</span>`
                  }
                </div>
              </div>
              <div class="win-right">
                <div class="bar-wrap"><div class="bar" style="width:${pct}%;background:${barColor(pct)}"></div></div>
                <span class="badge num ${toneClass(pct)}">${pct}%</span>
              </div>
            </div>`;
          })
          .join('');

        return `
        <div class="pool-cell">
          <div class="pool-cell-head">
            <span class="pool-cell-name">${escapeHtml(g.name)}</span>
            ${decisionBadge}
          </div>
          ${windowsHtml}
        </div>`;
      })
      .join('');

  const groupCards = renderGroupCardsFor(groups, wakeDecisions);
  const extraAccountsHtml = multiAccount
    ? agAccounts
        .slice(1)
        .map((acc) => {
          const accCards = acc.error
            ? `<div class="muted" style="color:var(--danger)">${escapeHtml(acc.error)}</div>`
            : renderGroupCardsFor(acc.groups || [], acc.wake_decisions || {}) ||
              '<div class="muted" data-i18n="noPoolData">Belum ada data pool kuota.</div>';
          return `
          <div class="extra-account">
            <div class="extra-account-head">
              <span class="pool-cell-name">${escapeHtml(acc.label || acc.id)}</span>
              <span class="badge">${escapeHtml(acc.plan_tier || (acc.error ? 'Error' : 'Active'))}</span>
            </div>
            <div class="subpools-grid">${accCards}</div>
          </div>`;
        })
        .join('')
    : '';

  const trendSeries = [
    { key: 'ag_gem_5h', title: 'Antigravity Gemini (5h)', color: '#8a94ff' },
    { key: 'ag_cg_5h', title: 'Antigravity Claude & GPT (5h)', color: '#34d399' },
    { key: 'gw_5h', title: 'Gemini Web (5h)', color: '#60a5fa' },
    { key: 'copilot', title: 'GitHub Copilot (Bulanan)', color: '#f59e0b' },
  ];
  const trendTiles = trendSeries
    .map((s) => {
      const rate = computeSeriesBurnRate(historyPoints, s.key);
      if (rate.current === null && historyPoints.length > 0) return '';
      const badgeText =
        rate.status === 'insufficient'
          ? 'Mengumpulkan data'
          : rate.status === 'steady'
            ? 'Stabil'
            : `-${rate.pctPerHour}%/jam${rate.etaHours !== null ? ` · habis ~${rate.etaHours}j` : ''}`;
      const badgeCls = rate.status === 'fast' ? 'is-danger' : rate.status === 'burning' ? 'is-warn' : 'is-ok';
      return `
        <div class="trend-tile">
          <div class="trend-head">
            <span class="trend-title">${escapeHtml(s.title)}</span>
            <span class="badge num ${rate.current !== null ? toneClass(rate.current) : ''}">${rate.current !== null ? `${rate.current}%` : '—'}</span>
          </div>
          ${renderSparklineSvg(historyPoints, s.key, s.color, s.title)}
          <div class="trend-foot">
            <span class="badge num ${rate.status === 'insufficient' ? '' : badgeCls}">${escapeHtml(badgeText)}</span>
            <span class="muted num">${historyPoints.length} sampel</span>
          </div>
        </div>`;
    })
    .filter(Boolean)
    .join('');

  const modelRows = models
    .map((m) => {
      const pct = m.remaining_percent ?? 0;
      const resetMs = toEpochMs(m.reset_at);
      return `
        <tr data-model-name="${escapeHtml((m.name + ' ' + m.id).toLowerCase())}">
          <td><strong>${escapeHtml(m.name)}</strong><br><span class="muted mono">${escapeHtml(m.id)}</span></td>
          <td>
            <div class="win-right">
              <div class="bar-wrap"><div class="bar" style="width:${pct}%;background:${barColor(pct)}"></div></div>
              <span class="pct num">${m.remaining_percent === null ? '—' : `${pct}%`}</span>
            </div>
          </td>
          <td class="num">
            ${
              resetMs
                ? `<span class="countdown" data-reset-ms="${resetMs}">${escapeHtml(formatReset(m.reset_at, offsetHours).split(' (')[0])}</span><br><span class="muted">${escapeHtml(formatLocalTime(resetMs, offsetHours))}</span>`
                : '—'
            }
          </td>
        </tr>`;
    })
    .join('');

  const copilotPct = copilot?.percent_remaining ?? copilot?.quota_percent ?? 0;
  const copilotResetMs = toEpochMs(copilot?.reset_at);
  const copilotCard = copilot
    ? `<div class="provider-card">
        <div class="pool-header">
          <div class="pool-title">
            <span class="provider-logo is-gh">${SVG_GH}</span>
            <span>GitHub Copilot</span>
          </div>
          <span class="badge">${escapeHtml(copilot.plan_tier || 'individual')}</span>
        </div>
        <div class="win-row">
          <div class="win-info">
            <div class="win-label" data-i18n="copilotMonthly">AI Credits (bulanan)</div>
            <div class="muted num">${
              copilot.error
                ? escapeHtml(copilot.error)
                : `${copilot.credits_used ?? '—'} <span data-i18n="usedWord">terpakai</span> · ${copilot.credits_remaining ?? '—'} / ${copilot.credits_entitlement ?? '—'} <span data-i18n="leftWord">sisa</span> · <span data-i18n="resetsIn">Reset dalam</span> <span class="countdown" data-reset-ms="${copilotResetMs || ''}">${escapeHtml(formatReset(copilot.reset_at, offsetHours).split(' (')[0])}</span>`
            }</div>
          </div>
          <div class="win-right">
            <div class="bar-wrap"><div class="bar" style="width:${copilotPct}%;background:${barColor(copilotPct)}"></div></div>
            <span class="badge num ${toneClass(copilotPct)}">${copilot.percent_remaining ?? copilot.quota_percent ?? '—'}%</span>
          </div>
        </div>
      </div>`
    : '';

  const geminiDailyLeft = Math.max(0, 100 - (geminiWeb?.daily_used ?? 0));
  const geminiWeeklyLeft = Math.max(0, 100 - (geminiWeb?.weekly_used ?? 0));
  const geminiDailyResetMs = toEpochMs(geminiWeb?.daily_reset_at);
  const geminiWeeklyResetMs = toEpochMs(geminiWeb?.weekly_reset_at);
  const formatPaceLine = (usedPct, resetMs, hours) => {
    const f = computeBurnRateForecast(usedPct, resetMs, hours);
    if (!f) return '';
    if (f.status === 'over_pace' && f.depletionMs) {
      const min = Math.max(1, Math.round(f.depletionMs / 60000));
      const h = Math.floor(min / 60);
      const m = min % 60;
      const dur = h > 0 ? `${h}h ${m}m` : `${m}m`;
      return ` · <span style="color:var(--warn)"><span data-i18n="paceOver">Boros</span> (~${dur})</span>`;
    }
    return ` · <span data-i18n="paceSafe">Laju aman</span> (${f.elapsedPct}%)`;
  };
  const geminiCard = geminiWeb
    ? `<div class="provider-card">
        <div class="pool-header">
          <div class="pool-title">
            <span class="provider-logo is-gemini">${SVG_GEMINI}</span>
            <span>Google Gemini Web</span>
          </div>
          <span class="badge">${escapeHtml(geminiWeb.plan_tier || 'Extension Sync')}</span>
        </div>
        <div class="win-row">
          <div class="win-info">
            <div class="win-label" data-i18n="geminiSession">Sesi 5h / Saat ini</div>
            <div class="muted num">Reset: ${escapeHtml(geminiWeb.daily_reset_label || '—')} ${
              geminiDailyResetMs
                ? `(<span class="countdown" data-reset-ms="${geminiDailyResetMs}">${escapeHtml(formatReset(geminiWeb.daily_reset_at, offsetHours).split(' (')[0])}</span>)`
                : `<span class="gemini-countdown" data-gemini-label="${escapeHtml(geminiWeb.daily_reset_label || '')}" data-gemini-kind="daily"></span>`
            } · ${geminiWeb.daily_used ?? '—'}% <span data-i18n="usedWord">terpakai</span>${formatPaceLine(geminiWeb.daily_used ?? 0, geminiDailyResetMs, 5)}</div>
          </div>
          <div class="win-right">
            <div class="bar-wrap"><div class="bar" style="width:${geminiDailyLeft}%;background:${barColor(geminiDailyLeft)}"></div></div>
            <span class="badge num ${toneClass(geminiDailyLeft)}">${geminiDailyLeft}%</span>
          </div>
        </div>
        <div class="win-row">
          <div class="win-info">
            <div class="win-label" data-i18n="geminiWeekly">Batas Mingguan</div>
            <div class="muted num">Reset: ${escapeHtml(geminiWeb.weekly_reset_label || '—')} ${
              geminiWeeklyResetMs
                ? `(<span class="countdown" data-reset-ms="${geminiWeeklyResetMs}">${escapeHtml(formatReset(geminiWeb.weekly_reset_at, offsetHours).split(' (')[0])}</span>)`
                : `<span class="gemini-countdown" data-gemini-label="${escapeHtml(geminiWeb.weekly_reset_label || '')}" data-gemini-kind="weekly"></span>`
            } · ${geminiWeb.weekly_used ?? '—'}% <span data-i18n="usedWord">terpakai</span>${formatPaceLine(geminiWeb.weekly_used ?? 0, geminiWeeklyResetMs, 168)}</div>
          </div>
          <div class="win-right">
            <div class="bar-wrap"><div class="bar" style="width:${geminiWeeklyLeft}%;background:${barColor(geminiWeeklyLeft)}"></div></div>
            <span class="badge num ${toneClass(geminiWeeklyLeft)}">${geminiWeeklyLeft}%</span>
          </div>
        </div>
      </div>`
    : '';

  const wakeRes = wakeState?.lastWakeResult;
  const wakeTokenParts = [];
  if (wakeRes?.promptTokens !== null && wakeRes?.promptTokens !== undefined) wakeTokenParts.push(`in:${wakeRes.promptTokens}`);
  if (wakeRes?.thoughtsTokens !== null && wakeRes?.thoughtsTokens !== undefined) wakeTokenParts.push(`think:${wakeRes.thoughtsTokens}`);
  if (wakeRes?.outputTokens !== null && wakeRes?.outputTokens !== undefined) wakeTokenParts.push(`out:${wakeRes.outputTokens}`);
  const wakeTokenMeta = wakeRes && wakeRes.totalTokens !== null && wakeRes.totalTokens !== undefined
    ? ` · <span class="num">${wakeRes.totalTokens} tok${wakeTokenParts.length ? ` (${wakeTokenParts.join(' · ')})` : ''}</span>`
    : '';
  const lastWake = wakeRes
    ? `<strong>${escapeHtml(wakeRes.model)}</strong> · <span class="rel-time" data-iso="${escapeHtml(wakeRes.triggeredAt)}">${escapeHtml(wakeRes.triggeredAt)}</span>${wakeTokenMeta}<br><span class="muted"><span data-i18n="replyLabel">Balasan</span>: "${escapeHtml(wakeRes.reply)}"</span>`
    : `<span class="muted" data-i18n="noWakeYet">Belum ada riwayat auto-wake</span>`;

  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="description" content="Cloudflare Worker dashboard for Antigravity, GitHub Copilot, and Google Gemini Web quota tracking and Auto-Wake automation." />
  <title>Quota Reset Automation</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <script>
    (function () {
      var saved = localStorage.getItem('qra_theme');
      var theme = saved === 'light' || saved === 'dark'
        ? saved
        : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
      document.documentElement.dataset.theme = theme;
    })();
  </script>
  <style>
    :root, [data-theme="dark"] {
      color-scheme: dark;
      /* Linear dark craft tokens (unified with Chrome extension) */
      --bg: #08090a;
      --surface: #0f1011;
      --surface-inset: #16171a;
      --surface-hover: #1e2024;
      --topbar-bg: rgba(8, 9, 10, 0.88);
      --text: #f7f8f8;
      --muted: #9ba1a6;
      --subtle: #6e747c;
      --border: #23252a;
      --border-strong: #34363d;
      --accent: #5e6ad2;
      --accent-hover: #6e7ae2;
      --accent-soft: #8a94ff;
      --ok: #34d399;
      --warn: #f59e0b;
      --danger: #f87171;
      --rounded-box: 12px;
      --rounded-btn: 8px;
      --rounded-badge: 6px;
      --ease: cubic-bezier(0.2, 0, 0, 1);
    }
    [data-theme="light"] {
      color-scheme: light;
      --bg: #f6f7f8;
      --surface: #ffffff;
      --surface-inset: #eef0f3;
      --surface-hover: #e5e8ed;
      --topbar-bg: rgba(246, 247, 248, 0.9);
      --text: #111318;
      --muted: #525866;
      --subtle: #6b7280;
      --border: #e2e5ea;
      --border-strong: #cbd0d8;
      --accent: #4e5bc4;
      --accent-hover: #424eb2;
      --accent-soft: #4e5bc4;
      --ok: #047857;
      --warn: #b45309;
      --danger: #b91c1c;
    }
    *, *::before, *::after { box-sizing: border-box; }
    :focus-visible { outline: 2px solid var(--accent-soft); outline-offset: 2px; }
    body {
      margin: 0;
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 15px;
      background: var(--bg);
      color: var(--text);
      padding: 0 20px 64px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    .wrap { max-width: 980px; margin: 0 auto; }
    .num { font-variant-numeric: tabular-nums; }
    .mono { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.75rem; }

    /* Sticky Topbar */
    .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding: 14px 0 13px;
      margin-bottom: 18px;
      background: var(--topbar-bg);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-mark {
      width: 36px; height: 36px;
      border-radius: var(--rounded-btn);
      background: var(--surface);
      border: 1px solid var(--border-strong);
      display: grid; place-items: center;
      color: var(--accent-soft);
    }
    h1 { font-size: 1.1rem; font-weight: 650; letter-spacing: -0.02em; text-wrap: balance; margin: 0; }
    .subline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px; font-size: 0.8rem; color: var(--muted); }
    .top-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pill {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 6px 11px;
      border-radius: var(--rounded-btn);
      background: var(--surface);
      border: 1px solid var(--border);
      font-size: 0.78rem;
      color: var(--muted);
    }
    .dot { width: 7px; height: 7px; border-radius: 999px; background: var(--ok); flex-shrink: 0; }

    /* Segmented Language Switch */
    .lang-switch {
      display: inline-flex;
      padding: 3px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--rounded-btn);
      gap: 2px;
    }
    .lang-btn {
      border: 0;
      background: transparent;
      color: var(--muted);
      padding: 4px 9px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 140ms var(--ease), color 140ms var(--ease);
    }
    .lang-btn:hover { color: var(--text); }
    .lang-btn.is-active { background: var(--surface-inset); color: var(--text); box-shadow: inset 0 0 0 1px var(--border-strong); }
    .theme-btn {
      width: 32px; height: 32px;
      border-radius: var(--rounded-btn);
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--muted);
      display: grid; place-items: center;
      cursor: pointer;
      transition: background-color 140ms var(--ease), border-color 140ms var(--ease), color 140ms var(--ease);
    }
    .theme-btn:hover { background: var(--surface-inset); border-color: var(--border-strong); color: var(--text); }

    /* Unified Telemetry Strip */
    .kpi-strip {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--rounded-box);
      margin-bottom: 14px;
      overflow: hidden;
    }
    .kpi-cell {
      padding: 15px 18px;
      border-right: 1px solid var(--border);
      transition: background-color 150ms var(--ease);
    }
    .kpi-cell:hover { background: var(--surface-inset); }
    .kpi-cell:last-child { border-right: 0; }
    @media (max-width: 760px) {
      .kpi-strip { grid-template-columns: 1fr; }
      .kpi-cell { border-right: 0; border-bottom: 1px solid var(--border); }
      .kpi-cell:last-child { border-bottom: 0; }
    }
    .kpi-label { display: flex; align-items: center; gap: 7px; font-size: 0.78rem; color: var(--muted); font-weight: 500; }
    .kpi-val { font-size: 1.45rem; font-weight: 700; letter-spacing: -0.025em; margin: 5px 0 2px; }
    .muted { color: var(--muted); font-size: 0.8rem; }

    /* Compact Command & Sync Bar */
    .actions {
      display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
      padding: 10px 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--rounded-box);
      margin-bottom: 14px;
    }
    .input-wrap { position: relative; flex: 1; min-width: 210px; display: flex; align-items: center; }
    input[type="password"], input[type="text"], input[type="number"], input[type="search"] {
      width: 100%;
      background: var(--bg); color: var(--text);
      border: 1px solid var(--border); border-radius: var(--rounded-btn);
      padding: 8px 36px 8px 12px; font-size: 0.84rem; outline: none;
      transition: border-color 140ms var(--ease), box-shadow 140ms var(--ease);
    }
    input::placeholder { color: var(--subtle); }
    input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(94, 106, 210, 0.22); }
    .eye-btn {
      position: absolute; right: 6px; width: 26px; height: 26px; padding: 0;
      border: 0; border-radius: 6px; background: transparent; color: var(--muted);
      display: grid; place-items: center; cursor: pointer;
      transition: color 140ms var(--ease), background-color 140ms var(--ease);
    }
    .eye-btn:hover { color: var(--text); background: var(--surface-inset); }
    .btn {
      display: inline-flex; align-items: center; gap: 7px;
      background: var(--accent); border: 1px solid transparent; color: #fff;
      border-radius: var(--rounded-btn); padding: 8px 14px; min-height: 36px; font-size: 0.82rem; font-weight: 600;
      cursor: pointer;
      transition: background-color 140ms var(--ease), border-color 140ms var(--ease), opacity 140ms var(--ease);
    }
    .btn:hover:not(:disabled) { background: var(--accent-hover); }
    .btn:disabled { cursor: not-allowed; opacity: 0.58; }
    .btn.sec { background: var(--surface-inset); border-color: var(--border-strong); color: var(--text); }
    .btn.sec:hover:not(:disabled) { background: var(--surface-hover); border-color: var(--accent-soft); }
    pre {
      background: var(--surface); border: 1px solid var(--border);
      padding: 12px 14px; border-radius: var(--rounded-btn); font-size: 0.77rem; overflow: auto;
      display: none; margin: 0 0 14px;
    }

    /* Provider Cards & Flat Hairline Pools */
    .pools { display: flex; flex-direction: column; gap: 14px; }
    .secondary-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 14px;
    }
    @media (min-width: 760px) {
      .secondary-grid {
        grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      }
    }
    .provider-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--rounded-box);
      padding: 16px 18px;
      transition: border-color 160ms var(--ease);
    }
    .provider-card:hover {
      border-color: var(--border-strong);
    }
    .pool-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 8px; }
    .pool-title { display: inline-flex; align-items: center; gap: 9px; font-size: 0.95rem; font-weight: 650; letter-spacing: -0.01em; }
    .provider-logo {
      width: 28px; height: 28px;
      border-radius: 7px;
      background: var(--surface-inset);
      border: 1px solid var(--border-strong);
      display: grid; place-items: center;
      flex-shrink: 0;
    }
    .provider-logo svg { width: 15px; height: 15px; fill: currentColor; }
    .provider-logo.is-ag { color: var(--accent-soft); }
    .provider-logo.is-gh { color: var(--text); }
    .provider-logo.is-gemini { color: var(--accent-soft); }
    .kpi-logo { width: 15px; height: 15px; display: inline-flex; align-items: center; }
    .kpi-logo svg { width: 15px; height: 15px; fill: currentColor; }

    .subpools-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
      border-top: 1px solid var(--border);
      padding-top: 12px;
    }
    @media (min-width: 760px) {
      .subpools-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    .pool-cell {
      padding: 12px 14px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    .pool-cell-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .pool-cell-name {
      font-size: 0.88rem;
      font-weight: 600;
      color: var(--text);
    }
    .win-row {
      display: flex; justify-content: space-between; align-items: center;
      gap: 12px; padding: 6px 0;
      border-top: 1px solid var(--border);
    }
    .win-row:first-of-type { border-top: 0; padding-top: 2px; }
    .win-info { min-width: 0; }
    .win-label { font-size: 0.8rem; font-weight: 500; color: var(--text); margin-bottom: 2px; }
    .win-right { display: flex; align-items: center; gap: 9px; flex-shrink: 0; }
    .bar-wrap { width: 92px; height: 6px; background: var(--surface-inset); border-radius: 999px; overflow: hidden; }
    .bar { height: 100%; border-radius: 999px; transition: width 260ms var(--ease); }

    /* Semantic badges */
    .badge {
      display: inline-flex; align-items: center;
      padding: 2px 8px; border-radius: var(--rounded-badge);
      font-size: 0.74rem; font-weight: 600;
      background: var(--surface-inset); color: var(--muted);
      border: 1px solid var(--border);
      white-space: nowrap;
    }
    .badge.is-ok { color: var(--ok); background: rgba(52, 211, 153, 0.1); border-color: rgba(52, 211, 153, 0.28); }
    .badge.is-warn { color: var(--warn); background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.28); }
    .badge.is-danger { color: var(--danger); background: rgba(248, 113, 113, 0.12); border-color: rgba(248, 113, 113, 0.3); }

    /* Details Table inside Antigravity */
    .provider-card details { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
    summary {
      display: inline-flex; align-items: center; gap: 6px;
      cursor: pointer; color: var(--muted); font-size: 0.83rem; font-weight: 500;
      padding: 4px 0;
      transition: color 140ms var(--ease);
    }
    summary:hover { color: var(--text); }
    .table-tools { margin: 10px 0 8px; }
    .table-wrap { overflow-x: auto; border-radius: var(--rounded-btn); border: 1px solid var(--border); background: var(--bg); }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 9px 13px; border-bottom: 1px solid var(--border); font-size: 0.82rem; }
    tbody tr { transition: background-color 120ms var(--ease); }
    tbody tr:hover td { background: var(--surface-inset); }
    tr:last-child td { border-bottom: 0; }
    th { color: var(--muted); font-weight: 600; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.04em; background: var(--surface-inset); }

    /* Google Calendar & Tasks Settings Panel */
    .cal-panel {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--rounded-box);
      padding: 13px 16px;
      margin-bottom: 14px;
      transition: border-color 150ms var(--ease);
    }
    .cal-panel:hover { border-color: var(--border-strong); }
    .cal-panel summary {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      width: 100%; cursor: pointer; font-weight: 600; font-size: 0.875rem; color: var(--text); list-style: none; padding: 0;
    }
    .cal-panel summary::-webkit-details-marker { display: none; }
    .cal-summary-left { display: inline-flex; align-items: center; gap: 9px; }
    .cal-summary-right { display: inline-flex; align-items: center; gap: 8px; }
    .cal-chevron { color: var(--muted); transition: transform 160ms var(--ease); }
    .cal-panel[open] .cal-chevron { transform: rotate(180deg); }
    .cal-body { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 12px; }
    .cal-section-label { font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 6px; }
    .cal-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
      gap: 8px;
    }
    .cal-check {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; min-height: 36px;
      background: var(--bg); border: 1px solid var(--border); border-radius: var(--rounded-btn);
      font-size: 0.8rem; font-weight: 500; color: var(--text); cursor: pointer;
      transition: border-color 140ms var(--ease), background-color 140ms var(--ease);
    }
    .cal-check:hover { border-color: var(--border-strong); background: var(--surface-inset); }
    .cal-check:has(input:checked) { border-color: rgba(94, 106, 210, 0.55); background: rgba(94, 106, 210, 0.09); }
    .cal-check input[type="checkbox"] { accent-color: var(--accent); width: 15px; height: 15px; margin: 0; flex-shrink: 0; cursor: pointer; }
    .cal-inputs {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 240px));
      gap: 10px;
    }
    .cal-field { display: flex; flex-direction: column; gap: 4px; font-size: 0.76rem; font-weight: 500; color: var(--muted); }
    .cal-field input { padding: 7px 10px; }
    .cal-hint { font-size: 0.72rem; color: var(--subtle); font-weight: 400; }
    .cal-footer { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; padding-top: 4px; }
    .cal-btns { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .cal-msg { font-size: 0.78rem; font-weight: 500; color: var(--muted); }
    .cal-msg.is-ok { color: var(--ok); }
    .cal-msg.is-danger { color: var(--danger); }

    /* Burn-Rate & Usage History Sparklines */
    .trend-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--rounded-box);
      padding: 15px 18px;
      margin-bottom: 14px;
    }
    .trend-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 10px;
    }
    .trend-tile {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .trend-head, .trend-foot {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
    }
    .trend-title { font-size: 0.78rem; font-weight: 600; color: var(--text); }
    .sparkline { width: 100%; height: 42px; display: block; }
    .extra-account { margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--border-strong); }
    .extra-account-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }

    svg.lucide { width: 15px; height: 15px; stroke-width: 1.85; flex-shrink: 0; }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark"><i data-lucide="activity"></i></div>
        <div>
          <h1>Quota Reset Automation</h1>
          <div class="subline">
            <span>Tier: <strong>${escapeHtml(ag?.plan_tier || '—')}</strong></span>
            <span>·</span>
            <span class="num"><span data-i18n="lastSyncLabel">Sinkronisasi</span>: ${updatedAt ? escapeHtml(updatedAt) : '<span data-i18n="noDataYet">Belum ada data</span>'}</span>
          </div>
        </div>
      </div>
      <div class="top-right">
        <div class="pill num">
          <span class="dot"></span>
          <span><span data-i18n="nextCronLabel">Cron berikutnya</span>: <strong id="nextCron">--:--</strong></span>
        </div>
        <div class="lang-switch" role="group" aria-label="Pilih bahasa / Select language">
          <button type="button" class="lang-btn is-active" data-lang="id" aria-pressed="true">ID</button>
          <button type="button" class="lang-btn" data-lang="en" aria-pressed="false">EN</button>
        </div>
        <button id="themeToggle" type="button" class="theme-btn" title="Ganti tema terang/gelap" aria-label="Ganti tema terang/gelap" aria-pressed="false">
          <i data-lucide="sun" aria-hidden="true"></i>
        </button>
      </div>
    </header>

    <section class="kpi-strip">
      <div class="kpi-cell">
        <div class="kpi-label"><span class="kpi-logo" style="color:var(--accent-soft)">${SVG_AG}</span><span>Antigravity 5h Reset</span></div>
        <div class="kpi-val num countdown" data-reset-ms="${agResetMs || ''}">${agResetMs ? escapeHtml(formatReset(ag.rolling_reset_at, offsetHours).split(' (')[0]) : '—'}</div>
        <div class="muted num">${agResetMs ? escapeHtml(formatLocalTime(agResetMs, offsetHours)) : '<span data-i18n="waitingNextCycle">Menunggu siklus berikutnya</span>'}</div>
      </div>
      <div class="kpi-cell">
        <div class="kpi-label"><span class="kpi-logo" style="color:var(--text)">${SVG_GH}</span><span>GitHub Copilot</span></div>
        <div class="kpi-val num">${copilot?.quota_percent ?? '—'}%</div>
        <div class="muted num">${
          copilot?.error
            ? escapeHtml(copilot.error)
            : copilotResetMs
              ? `<span data-i18n="resetsIn">Reset dalam</span> <span class="countdown" data-reset-ms="${copilotResetMs}">${escapeHtml(formatReset(copilot.reset_at, offsetHours).split(' (')[0])}</span>`
              : `<span data-i18n="inactive">Tidak aktif</span>`
        }</div>
      </div>
      <div class="kpi-cell">
        <div class="kpi-label"><i data-lucide="zap"></i><span data-i18n="lastWakeTitle">Auto-Wake Terakhir</span></div>
        <div style="font-size:0.84rem;margin-top:8px;">${lastWake}</div>
      </div>
    </section>

    <section class="actions">
      <div class="input-wrap">
        <input id="tok" type="password" data-i18n-placeholder="tokenPlaceholder" placeholder="Contoh: qra-9f4a2c8e..." aria-label="X-Auth-Token" autocomplete="off" />
        <button id="toggleTok" type="button" class="eye-btn" title="Tampilkan token" aria-label="Tampilkan token"><i data-lucide="eye"></i></button>
      </div>
      <button id="btnSync" class="btn" type="button"><i data-lucide="refresh-cw"></i><span data-i18n="btnSyncTick">Jalankan sinkronisasi</span></button>
      <button id="btnWake" class="btn sec" type="button"><i data-lucide="zap"></i><span data-i18n="btnForceWake">Kirim wake sekarang</span></button>
    </section>
    <pre id="out" aria-live="polite"></pre>

    <details class="cal-panel" id="calPanel">
      <summary>
        <span class="cal-summary-left">
          <i data-lucide="calendar-check" aria-hidden="true"></i>
          <span data-i18n="calPanelTitle">Google Calendar &amp; Tasks (Reset Mingguan)</span>
        </span>
        <span class="cal-summary-right">
          <span class="badge ${calConfigured ? (calCfg.enabled ? 'is-ok' : '') : 'is-warn'}" id="calStatusBadge">
            ${calConfigured ? (calCfg.enabled ? 'Aktif' : 'Siap') : 'OAuth belum disetup'}
          </span>
          <i data-lucide="chevron-down" class="cal-chevron" aria-hidden="true"></i>
        </span>
      </summary>
      <div class="cal-body">
        <div class="muted" data-i18n="calPanelNote">
          Hanya menyinkronkan reset mingguan (dan opsional bulanan Copilot); limit 5 jam tidak dimasukkan. Isi X-Auth-Token di atas untuk menyimpan.
        </div>
        <div>
          <div class="cal-section-label" data-i18n="calTargetSection">Tujuan &amp; Mode</div>
          <div class="cal-grid">
            <label class="cal-check"><input type="checkbox" id="calEnabled" ${calCfg.enabled ? 'checked' : ''} /> <span data-i18n="calEnabled">Aktifkan auto-sync</span></label>
            <label class="cal-check"><input type="checkbox" id="calSyncCalendar" ${calCfg.syncCalendar ? 'checked' : ''} /> <span>Google Calendar</span></label>
            <label class="cal-check"><input type="checkbox" id="calSyncTasks" ${calCfg.syncTasks ? 'checked' : ''} /> <span>Google Tasks</span></label>
            <label class="cal-check"><input type="checkbox" id="calAllDay" ${calCfg.allDay ? 'checked' : ''} /> <span data-i18n="calAllDay">Seharian (tanpa jam)</span></label>
          </div>
        </div>
        <div>
          <div class="cal-section-label" data-i18n="calSourceSection">Jadwal Reset</div>
          <div class="cal-grid">
            <label class="cal-check"><input type="checkbox" id="calAgWeekly" ${calCfg.includeAntigravityWeekly ? 'checked' : ''} /> <span>Antigravity Weekly</span></label>
            <label class="cal-check"><input type="checkbox" id="calGwWeekly" ${calCfg.includeGeminiWebWeekly ? 'checked' : ''} /> <span>Gemini Web Weekly</span></label>
            <label class="cal-check"><input type="checkbox" id="calCopilotMonthly" ${calCfg.includeCopilotMonthly ? 'checked' : ''} /> <span>Copilot Monthly</span></label>
          </div>
        </div>
        <div class="cal-inputs">
          <label class="cal-field">
            <span data-i18n="calIdLabel">Calendar ID</span>
            <input id="calId" type="text" value="${escapeHtml(calCfg.calendarId || 'primary')}" placeholder="primary" />
            <span class="cal-hint" data-i18n="calIdHint">Biarkan primary untuk kalender utama</span>
          </label>
          <label class="cal-field">
            <span data-i18n="calReminderLabel">Pengingat (menit)</span>
            <input id="calReminder" type="number" min="0" max="1440" value="${Number(calCfg.reminderMinutes ?? 15)}" />
            <span class="cal-hint" data-i18n="calReminderHint">0 = tanpa notifikasi popup</span>
          </label>
        </div>
        <div class="cal-footer">
          <div class="cal-btns">
            <button id="btnCalSave" class="btn" type="button"><i data-lucide="save" aria-hidden="true"></i><span data-i18n="btnCalSave">Simpan pengaturan</span></button>
            <button id="btnCalSync" class="btn sec" type="button"><i data-lucide="refresh-cw" aria-hidden="true"></i><span data-i18n="btnCalSync">Sync sekarang</span></button>
          </div>
          <span id="calMsg" class="cal-msg" role="status" aria-live="polite"></span>
        </div>
      </div>
    </details>

    <section class="trend-card" aria-label="Tren Pemakaian & Burn-Rate">
      <div class="pool-header" style="margin-bottom:10px;">
        <div class="pool-title">
          <i data-lucide="trending-down" aria-hidden="true"></i>
          <span data-i18n="trendCardTitle">Tren Pemakaian &amp; Burn-Rate (24j)</span>
        </div>
        <span class="badge num">${historyPoints.length} / 96</span>
      </div>
      <div class="trend-grid">
        ${trendTiles || '<div class="muted">Mengumpulkan riwayat pemakaian setiap 15 menit...</div>'}
      </div>
    </section>

    <section class="pools">
      <div class="provider-card">
        <div class="pool-header">
          <div class="pool-title">
            <span class="provider-logo is-ag">${SVG_AG}</span>
            <span>Antigravity${multiAccount ? ` (${agAccounts.length} akun)` : ''}</span>
          </div>
          <span class="badge">${escapeHtml(ag?.plan_tier || 'Active')}</span>
        </div>
        <div class="subpools-grid">
          ${groupCards || '<div class="muted" data-i18n="noPoolData">Belum ada data pool kuota.</div>'}
        </div>
        ${extraAccountsHtml}
        <details>
          <summary><i data-lucide="list"></i><span><span data-i18n="allModelsTitle">Detail semua model Antigravity</span> (${models.length})</span></summary>
          <div class="table-tools">
            <input id="modelFilter" type="search" data-i18n-placeholder="filterPlaceholder" placeholder="Cari model (contoh: claude, gemini, gpt)" style="max-width:300px;padding:7px 10px;" />
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th data-i18n="colModel">Model</th><th data-i18n="colRemaining">Sisa</th><th data-i18n="colCountdown">Hitung Mundur Reset</th></tr></thead>
              <tbody>${modelRows || '<tr><td colspan="3" class="muted" data-i18n="noModelData">Belum ada data model.</td></tr>'}</tbody>
            </table>
          </div>
        </details>
      </div>
      ${
        copilotCard || geminiCard
          ? `<div class="secondary-grid">${copilotCard}${geminiCard}</div>`
          : ''
      }
    </section>
  </div>

  <script src="https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js"></script>
  <script>
    if (window.lucide) window.lucide.createIcons();

    const I18N = {
      id: {
        lastSyncLabel: 'Sinkronisasi',
        noDataYet: 'Belum ada data',
        nextCronLabel: 'Cron berikutnya',
        waitingNextCycle: 'Menunggu siklus berikutnya',
        resetsIn: 'Reset dalam',
        readyFull: 'Siap / 100% penuh',
        inactive: 'Tidak aktif',
        lastWakeTitle: 'Auto-Wake Terakhir',
        replyLabel: 'Balasan',
        noWakeYet: 'Belum ada riwayat auto-wake',
        noPoolData: 'Belum ada data pool kuota.',
        copilotMonthly: 'AI Credits (bulanan)',
        usedWord: 'terpakai',
        leftWord: 'sisa',
        geminiSession: 'Sesi 5h / Saat ini',
        geminiWeekly: 'Batas Mingguan',
        allModelsTitle: 'Detail semua model Antigravity',
        filterPlaceholder: 'Cari model (contoh: claude, gemini, gpt)',
        colModel: 'Model',
        colRemaining: 'Sisa',
        colCountdown: 'Hitung Mundur Reset',
        noModelData: 'Belum ada data model.',
        tokenPlaceholder: 'X-Auth-Token (contoh: qra-9f4a...)',
        btnSyncTick: 'Jalankan sinkronisasi',
        btnForceWake: 'Kirim wake sekarang',
        readyNow: '00:00:00 (siap)',
        paceSafe: 'Laju aman',
        paceOver: 'Boros',
        wake_manual_force: 'paksa manual',
        wake_weekly_exhausted: 'limit mingguan habis',
        wake_cooldown_active: 'jeda aktif',
        wake_safety_margin: 'margin aman 2m',
        wake_already_triggered_for_cycle: 'siklus sudah aktif',
        wake_not_full: 'siklus berjalan',
        wake_all_guards_passed: 'siap wake',
        wake_idle_5h_rolling: 'timer 5h idle',
        wake_missing_reset_time: 'menunggu reset time',
        wake_wake_failed: 'wake gagal',
        wake_disabled: 'nonaktif',
        wake_outside_time_window: 'di luar jadwal',
        calPanelTitle: 'Google Calendar & Tasks (Reset Mingguan)',
        calPanelNote: 'Hanya menyinkronkan reset mingguan (dan opsional bulanan Copilot); limit 5 jam tidak dimasukkan. Isi X-Auth-Token di atas untuk menyimpan.',
        calTargetSection: 'Tujuan & Mode',
        calSourceSection: 'Jadwal Reset',
        calEnabled: 'Aktifkan auto-sync',
        calAllDay: 'Seharian (tanpa jam)',
        calIdLabel: 'Calendar ID',
        calIdHint: 'Biarkan primary untuk kalender utama',
        calReminderLabel: 'Pengingat (menit)',
        calReminderHint: '0 = tanpa notifikasi popup',
        btnCalSave: 'Simpan pengaturan',
        btnCalSync: 'Sync sekarang',
      },
      en: {
        lastSyncLabel: 'Last sync',
        noDataYet: 'No data yet',
        nextCronLabel: 'Next cron',
        waitingNextCycle: 'Waiting for next cycle',
        resetsIn: 'Resets in',
        readyFull: 'Ready / 100% full',
        inactive: 'Inactive',
        lastWakeTitle: 'Last Auto-Wake',
        replyLabel: 'Reply',
        noWakeYet: 'No auto-wake recorded yet',
        noPoolData: 'No quota pool data yet.',
        copilotMonthly: 'AI Credits (monthly)',
        usedWord: 'used',
        leftWord: 'left',
        geminiSession: 'Current session (5h)',
        geminiWeekly: 'Weekly limit',
        allModelsTitle: 'All Antigravity model details',
        filterPlaceholder: 'Filter models (e.g. claude, gemini, gpt)',
        colModel: 'Model',
        colRemaining: 'Remaining',
        colCountdown: 'Reset Countdown',
        noModelData: 'No model data yet.',
        tokenPlaceholder: 'X-Auth-Token (e.g. qra-9f4a...)',
        btnSyncTick: 'Run sync tick',
        btnForceWake: 'Trigger wake now',
        readyNow: '00:00:00 (ready)',
        paceSafe: 'On track',
        paceOver: 'Over pace',
        wake_manual_force: 'manual force',
        wake_weekly_exhausted: 'weekly exhausted',
        wake_cooldown_active: 'cooldown',
        wake_safety_margin: 'safety margin',
        wake_already_triggered_for_cycle: 'cycle active',
        wake_not_full: 'in use',
        wake_all_guards_passed: 'ready',
        wake_idle_5h_rolling: '5h idle rolling',
        wake_missing_reset_time: 'missing reset time',
        wake_wake_failed: 'wake failed',
        wake_disabled: 'disabled',
        wake_outside_time_window: 'outside window',
        calPanelTitle: 'Google Calendar & Tasks (Weekly Resets)',
        calPanelNote: 'Syncs weekly resets only (plus optional Copilot monthly); 5h windows are excluded. Enter X-Auth-Token above to save.',
        calTargetSection: 'Targets & Mode',
        calSourceSection: 'Reset Schedules',
        calEnabled: 'Enable auto-sync',
        calAllDay: 'All-day (no time)',
        calIdLabel: 'Calendar ID',
        calIdHint: 'Leave primary for your main calendar',
        calReminderLabel: 'Reminder (minutes)',
        calReminderHint: '0 = no popup notification',
        btnCalSave: 'Save settings',
        btnCalSync: 'Sync now',
      },
    };

    let currentLang = localStorage.getItem('qra_lang') === 'en' ? 'en' : 'id';

    function applyLanguage(lang) {
      currentLang = lang === 'en' ? 'en' : 'id';
      localStorage.setItem('qra_lang', currentLang);
      document.documentElement.lang = currentLang;
      const dict = I18N[currentLang];

      document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) el.textContent = dict[key];
      });

      document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (dict[key]) el.placeholder = dict[key];
      });

      document.querySelectorAll('.lang-btn').forEach((btn) => {
        const active = btn.dataset.lang === currentLang;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', String(active));
      });

      tickTimers();
    }

    document.querySelectorAll('.lang-btn').forEach((btn) => {
      btn.addEventListener('click', () => applyLanguage(btn.dataset.lang));
    });

    const themeBtn = document.getElementById('themeToggle');
    function applyTheme(next) {
      const theme = next === 'light' ? 'light' : 'dark';
      document.documentElement.dataset.theme = theme;
      localStorage.setItem('qra_theme', theme);
      if (themeBtn) {
        const isLight = theme === 'light';
        themeBtn.setAttribute('aria-pressed', String(isLight));
        themeBtn.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
        themeBtn.innerHTML = '<i data-lucide="' + (isLight ? 'moon' : 'sun') + '" aria-hidden="true"></i>';
        if (window.lucide) window.lucide.createIcons({ root: themeBtn });
      }
    }
    applyTheme(document.documentElement.dataset.theme || 'dark');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
      });
    }

    function formatCountdown(targetMs) {
      const diff = Math.max(0, Math.floor((targetMs - Date.now()) / 1000));
      if (diff <= 0) return I18N[currentLang].readyNow;
      const d = Math.floor(diff / 86400);
      const h = Math.floor((diff % 86400) / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      const pad = (n) => String(n).padStart(2, '0');
      return d > 0 ? d + 'd ' + pad(h) + ':' + pad(m) + ':' + pad(s) : pad(h) + ':' + pad(m) + ':' + pad(s);
    }

    function parseGeminiLabel(label, kind) {
      if (!label || label === 'Unknown' || label === '—') return null;
      const now = new Date();
      const months = { jan:0, feb:1, mar:2, apr:3, mei:4, may:4, jun:5, jul:6, agu:7, aug:7, sep:8, okt:9, oct:9, nov:10, des:11, dec:11 };
      const timeMatch = label.match(/(\\d{1,2})[.:](\\d{2})(?:\\s*(AM|PM))?/i);
      if (!timeMatch) return null;
      let hr = parseInt(timeMatch[1], 10);
      const min = parseInt(timeMatch[2], 10);
      const ap = timeMatch[3] ? timeMatch[3].toUpperCase() : null;
      if (ap === 'PM' && hr < 12) hr += 12;
      if (ap === 'AM' && hr === 12) hr = 0;

      if (kind === 'weekly') {
        const dateMatch = label.match(/(\\d{1,2})\\s+([A-Za-z]+)|([A-Za-z]+)\\s+(\\d{1,2})/);
        if (dateMatch) {
          const day = parseInt(dateMatch[1] || dateMatch[4], 10);
          const monKey = (dateMatch[2] || dateMatch[3]).slice(0, 3).toLowerCase();
          const mon = months[monKey];
          if (mon !== undefined) {
            const target = new Date(now.getFullYear(), mon, day, hr, min, 0, 0);
            if (target.getTime() < now.getTime() - 86400000) target.setFullYear(now.getFullYear() + 1);
            return target.getTime();
          }
        }
      }

      const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hr, min, 0, 0);
      if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
      return target.getTime();
    }

    function tickTimers() {
      document.querySelectorAll('.countdown[data-reset-ms]').forEach((el) => {
        const ms = Number(el.dataset.resetMs);
        if (ms > 0) el.textContent = formatCountdown(ms);
      });

      document.querySelectorAll('.gemini-countdown').forEach((el) => {
        const ms = parseGeminiLabel(el.dataset.geminiLabel, el.dataset.geminiKind);
        el.textContent = ms ? '(' + formatCountdown(ms) + ')' : '';
      });

      const nowSec = Math.floor(Date.now() / 1000);
      const nextCronRem = 300 - (nowSec % 300);
      const m = String(Math.floor(nextCronRem / 60)).padStart(2, '0');
      const s = String(nextCronRem % 60).padStart(2, '0');
      const cronEl = document.getElementById('nextCron');
      if (cronEl) cronEl.textContent = m + ':' + s;
    }

    applyLanguage(currentLang);
    setInterval(tickTimers, 1000);

    const filterInput = document.getElementById('modelFilter');
    if (filterInput) {
      filterInput.addEventListener('input', () => {
        const q = filterInput.value.trim().toLowerCase();
        document.querySelectorAll('tbody tr[data-model-name]').forEach((row) => {
          row.style.display = !q || row.dataset.modelName.includes(q) ? '' : 'none';
        });
      });
    }

    const tokInput = document.getElementById('tok');
    const savedTok = localStorage.getItem('qra_auth_token');
    if (savedTok && tokInput) tokInput.value = savedTok;

    const toggleTok = document.getElementById('toggleTok');
    if (toggleTok && tokInput) {
      toggleTok.addEventListener('click', () => {
        const show = tokInput.type === 'password';
        tokInput.type = show ? 'text' : 'password';
        toggleTok.innerHTML = '<i data-lucide="' + (show ? 'eye-off' : 'eye') + '"></i>';
        if (window.lucide) window.lucide.createIcons({ root: toggleTok });
      });
    }

    const btnSync = document.getElementById('btnSync');
    const btnWake = document.getElementById('btnWake');
    if (btnSync) btnSync.addEventListener('click', () => callApi('/api/automation/tick'));
    if (btnWake) btnWake.addEventListener('click', () => callApi('/api/automation/wake'));

    function readCalForm() {
      return {
        enabled: Boolean(document.getElementById('calEnabled')?.checked),
        syncCalendar: Boolean(document.getElementById('calSyncCalendar')?.checked),
        syncTasks: Boolean(document.getElementById('calSyncTasks')?.checked),
        includeAntigravityWeekly: Boolean(document.getElementById('calAgWeekly')?.checked),
        includeGeminiWebWeekly: Boolean(document.getElementById('calGwWeekly')?.checked),
        includeCopilotMonthly: Boolean(document.getElementById('calCopilotMonthly')?.checked),
        allDay: Boolean(document.getElementById('calAllDay')?.checked),
        calendarId: (document.getElementById('calId')?.value || 'primary').trim() || 'primary',
        reminderMinutes: Number(document.getElementById('calReminder')?.value ?? 15),
      };
    }

    const btnCalSave = document.getElementById('btnCalSave');
    const btnCalSync = document.getElementById('btnCalSync');
    if (btnCalSave) btnCalSave.addEventListener('click', () => callCalendarApi('/api/settings/calendar', 'PUT', readCalForm()));
    if (btnCalSync) btnCalSync.addEventListener('click', () => callCalendarApi('/api/calendar/sync', 'POST'));

    async function callCalendarApi(path, method, payload = null) {
      const msgEl = document.getElementById('calMsg');
      const badgeEl = document.getElementById('calStatusBadge');
      const btns = document.querySelectorAll('.cal-btns .btn');
      btns.forEach((b) => { b.disabled = true; });
      if (msgEl) { msgEl.className = 'cal-msg'; msgEl.textContent = 'Menyimpan...'; }
      try {
        const tok = tokInput.value.trim();
        if (tok) localStorage.setItem('qra_auth_token', tok);
        const headers = { 'X-Auth-Token': tok };
        if (payload !== null) headers['Content-Type'] = 'application/json';
        const res = await fetch(path, {
          method,
          headers,
          body: payload !== null ? JSON.stringify(payload) : undefined,
        });
        const body = await res.json().catch(() => ({ status: res.status }));
        if (res.ok && body.ok !== false) {
          const synced = body?.sync?.synced?.length ?? body?.synced?.length ?? 0;
          if (msgEl) {
            msgEl.className = 'cal-msg is-ok';
            msgEl.textContent = method === 'PUT'
              ? (synced > 0 ? 'Tersimpan & tersinkron (' + synced + ' item)' : 'Pengaturan tersimpan')
              : 'Tersinkron (' + synced + ' item)';
          }
          if (badgeEl && method === 'PUT' && body.configured) {
            badgeEl.textContent = body.settings?.enabled ? 'Aktif' : 'Siap';
            badgeEl.className = 'badge ' + (body.settings?.enabled ? 'is-ok' : '');
          }
        } else {
          const errMsg = (body.errors && body.errors[0]) || body.error || ('HTTP ' + res.status);
          if (msgEl) { msgEl.className = 'cal-msg is-danger'; msgEl.textContent = errMsg; }
        }
      } catch (err) {
        if (msgEl) { msgEl.className = 'cal-msg is-danger'; msgEl.textContent = err?.message || 'Network error'; }
      } finally {
        btns.forEach((b) => { b.disabled = false; });
      }
    }

    if (tokInput) {
      tokInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') callApi('/api/automation/tick');
      });
    }

    async function callApi(path, method = 'POST', payload = null) {
      const out = document.getElementById('out');
      const btns = document.querySelectorAll('.actions .btn, .cal-btns .btn');
      btns.forEach((b) => { b.disabled = true; b.style.opacity = '0.6'; });
      out.style.display = 'block';
      out.textContent = 'Running...';
      try {
        const tok = tokInput.value.trim();
        if (tok) localStorage.setItem('qra_auth_token', tok);
        const headers = { 'X-Auth-Token': tok };
        if (payload !== null) headers['Content-Type'] = 'application/json';
        const res = await fetch(path, {
          method,
          headers,
          body: payload !== null ? JSON.stringify(payload) : undefined,
        });
        const body = await res.json().catch(() => ({ status: res.status }));
        out.textContent = JSON.stringify(body, null, 2);
        if (res.ok && method === 'POST' && path.startsWith('/api/automation/')) {
          setTimeout(() => location.reload(), 1200);
        }
      } catch (err) {
        out.textContent = JSON.stringify({ error: err?.message || 'Network error' }, null, 2);
      } finally {
        btns.forEach((b) => { b.disabled = false; b.style.opacity = ''; });
      }
    }
  </script>
</body>
</html>`;
}
