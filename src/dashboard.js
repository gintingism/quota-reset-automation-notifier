/**
 * Lightweight HTML dashboard rendered from the latest KV snapshot (no secrets exposed).
 */

import { computeBurnRateForecast } from './gemini_rpc.js';

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

export function renderDashboardHtml(latest, wakeState, offsetHours = 7) {
  const ag = latest?.providers?.antigravity;
  const copilot = latest?.providers?.github_copilot;
  const geminiWeb = latest?.providers?.gemini_web;
  const groups = Array.isArray(ag?.groups) ? ag.groups : [];
  const models = Array.isArray(ag?.models) ? ag.models : [];

  const fetchedMs = latest?.fetched_at ? latest.fetched_at * 1000 : null;
  const updatedAt = fetchedMs
    ? new Date(fetchedMs + offsetHours * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) + ` UTC+${offsetHours}`
    : '';

  const agResetMs = toEpochMs(ag?.rolling_reset_at);

  const wakeDecisions = ag?.wake_decisions || {};
  const groupCards = groups
    .map((g) => {
      const lowerName = (g.name || '').toLowerCase();
      const poolKey = lowerName.includes('argon')
        ? 'argon'
        : lowerName.includes('gemini')
          ? 'gemini'
          : 'claude-gpt';
      const decision = wakeDecisions[poolKey];
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
  <style>
    :root {
      color-scheme: dark;
      /* daisyUI-inspired semantic tokens (night/slate) */
      --b1: #0b0f17;
      --b2: #111827;
      --b3: #1a2234;
      --bc: #f1f5f9;
      --bc-muted: #94a3b8;
      --p: #3b82f6;
      --p-hover: #2563eb;
      --su: #10b981;
      --wa: #f59e0b;
      --er: #ef4444;
      --rounded-box: 12px;
      --rounded-btn: 8px;
      --rounded-badge: 6px;

      /* Aliases */
      --bg: var(--b1);
      --surface: var(--b2);
      --surface-inset: var(--b3);
      --border: rgba(148, 163, 184, 0.14);
      --border-strong: rgba(148, 163, 184, 0.24);
      --text: var(--bc);
      --muted: var(--bc-muted);
      --accent: var(--p);
      --accent-hover: var(--p-hover);
      --ok: var(--su);
      --warn: var(--wa);
      --danger: var(--er);
      --ease: cubic-bezier(0.2, 0, 0, 1);
    }
    *, *::before, *::after { box-sizing: border-box; }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    body {
      margin: 0;
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 16px;
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
      padding: 16px 0 14px;
      margin-bottom: 20px;
      background: rgba(11, 15, 23, 0.86);
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
      color: var(--accent);
    }
    h1 { font-size: 1.125rem; font-weight: 650; letter-spacing: -0.02em; text-wrap: balance; margin: 0; }
    .subline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px; font-size: 0.8125rem; color: var(--muted); }
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

    /* daisyUI-style Tabbed Language Switch */
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
      transition: background-color 150ms var(--ease), color 150ms var(--ease), transform 120ms var(--ease);
    }
    .lang-btn:hover { color: var(--text); }
    .lang-btn:active { transform: scale(0.96); }
    .lang-btn.is-active { background: var(--surface-inset); color: var(--text); box-shadow: inset 0 0 0 1px var(--border-strong); }

    /* Unified Telemetry Strip (daisyUI stats-inspired) */
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
      padding: 16px 18px;
      border-right: 1px solid var(--border);
      transition: background-color 160ms var(--ease);
    }
    .kpi-cell:hover { background: rgba(26, 34, 52, 0.45); }
    .kpi-cell:last-child { border-right: 0; }
    @media (max-width: 760px) {
      .kpi-strip { grid-template-columns: 1fr; }
      .kpi-cell { border-right: 0; border-bottom: 1px solid var(--border); }
      .kpi-cell:last-child { border-bottom: 0; }
    }
    .kpi-label { display: flex; align-items: center; gap: 7px; font-size: 0.78rem; color: var(--muted); font-weight: 500; }
    .kpi-val { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.025em; margin: 6px 0 2px; }
    .muted { color: var(--muted); font-size: 0.8rem; }

    /* Compact Command & Sync Bar */
    .actions {
      display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
      padding: 10px 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--rounded-box);
      margin-bottom: 16px;
    }
    .input-wrap { position: relative; flex: 1; min-width: 210px; display: flex; align-items: center; }
    input {
      width: 100%;
      background: var(--bg); color: var(--text);
      border: 1px solid var(--border); border-radius: var(--rounded-btn);
      padding: 9px 36px 9px 12px; font-size: 0.84rem; outline: none;
      transition: border-color 150ms var(--ease), box-shadow 150ms var(--ease);
    }
    input::placeholder { color: #64748b; }
    input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16); }
    .eye-btn {
      position: absolute; right: 7px; width: 26px; height: 26px; padding: 0;
      border: 0; border-radius: 6px; background: transparent; color: var(--muted);
      display: grid; place-items: center; cursor: pointer;
      transition: color 150ms var(--ease), background-color 150ms var(--ease);
    }
    .eye-btn:hover { color: var(--text); background: var(--surface-inset); }
    .btn {
      display: inline-flex; align-items: center; gap: 7px;
      background: var(--accent); border: 1px solid transparent; color: #fff;
      border-radius: var(--rounded-btn); padding: 9px 14px; font-size: 0.83rem; font-weight: 600;
      cursor: pointer;
      transition: background-color 150ms var(--ease), transform 140ms var(--ease), border-color 150ms var(--ease), opacity 150ms var(--ease);
    }
    .btn:hover:not(:disabled) { background: var(--accent-hover); transform: translateY(-1px); }
    .btn:active:not(:disabled) { transform: scale(0.98); }
    .btn:disabled { cursor: not-allowed; }
    .btn.sec { background: var(--surface-inset); border-color: var(--border-strong); color: var(--text); }
    .btn.sec:hover:not(:disabled) { background: #222c42; border-color: rgba(148, 163, 184, 0.34); }
    pre {
      background: var(--surface); border: 1px solid var(--border);
      padding: 12px 14px; border-radius: var(--rounded-btn); font-size: 0.77rem; overflow: auto;
      display: none; margin: 0 0 16px;
    }

    /* Provider Cards & Flat Hairline Pools */
    .pools { display: flex; flex-direction: column; gap: 16px; }
    .secondary-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
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
      padding: 18px 20px;
      transition: border-color 180ms var(--ease), transform 180ms var(--ease);
    }
    .provider-card:hover {
      border-color: var(--border-strong);
    }
    .pool-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 8px; }
    .pool-title { display: inline-flex; align-items: center; gap: 9px; font-size: 0.96rem; font-weight: 650; letter-spacing: -0.01em; }
    .provider-logo {
      width: 28px; height: 28px;
      border-radius: 7px;
      background: var(--surface-inset);
      border: 1px solid var(--border-strong);
      display: grid; place-items: center;
      flex-shrink: 0;
    }
    .provider-logo svg { width: 15px; height: 15px; fill: currentColor; }
    .provider-logo.is-ag { color: #60a5fa; }
    .provider-logo.is-gh { color: #f0f6fc; }
    .provider-logo.is-gemini { color: #60a5fa; }
    .kpi-logo { width: 15px; height: 15px; display: inline-flex; align-items: center; }
    .kpi-logo svg { width: 15px; height: 15px; fill: currentColor; }

    .subpools-grid {
      display: grid;
      grid-template-columns: 1fr;
      border-top: 1px solid var(--border);
    }
    .pool-cell {
      padding: 13px 0;
      border-bottom: 1px solid var(--border);
    }
    .pool-cell:last-child { border-bottom: 0; padding-bottom: 2px; }
    .pool-cell-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .pool-cell-name {
      font-size: 0.89rem;
      font-weight: 600;
      color: var(--text);
    }
    .win-row {
      display: flex; justify-content: space-between; align-items: center;
      gap: 14px; padding: 7px 0;
    }
    .win-info { min-width: 0; }
    .win-label { font-size: 0.83rem; font-weight: 500; color: var(--text); margin-bottom: 2px; }
    .win-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
    .bar-wrap { width: 112px; height: 6px; background: var(--surface-inset); border-radius: 999px; overflow: hidden; }
    .bar { height: 100%; border-radius: 999px; transition: width 280ms var(--ease); }

    /* daisyUI-inspired semantic badges */
    .badge {
      display: inline-flex; align-items: center;
      padding: 2px 8px; border-radius: var(--rounded-badge);
      font-size: 0.75rem; font-weight: 600;
      background: var(--surface-inset); color: var(--muted);
      border: 1px solid var(--border);
      white-space: nowrap;
    }
    .badge.is-ok { color: var(--ok); background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.28); }
    .badge.is-warn { color: var(--warn); background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.28); }
    .badge.is-danger { color: var(--danger); background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.28); }

    /* Details Table inside Antigravity */
    details { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
    summary {
      display: inline-flex; align-items: center; gap: 6px;
      cursor: pointer; color: var(--muted); font-size: 0.83rem; font-weight: 500;
      padding: 4px 0;
      transition: color 150ms var(--ease);
    }
    summary:hover { color: var(--text); }
    .table-tools { margin: 10px 0 8px; }
    .table-wrap { overflow-x: auto; border-radius: var(--rounded-btn); border: 1px solid var(--border); background: var(--bg); }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 9px 13px; border-bottom: 1px solid var(--border); font-size: 0.83rem; }
    tbody tr { transition: background-color 120ms var(--ease); }
    tbody tr:hover td { background: rgba(26, 34, 52, 0.55); }
    tr:last-child td { border-bottom: 0; }
    th { color: var(--muted); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; background: var(--surface-inset); }

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
      </div>
    </header>

    <section class="kpi-strip">
      <div class="kpi-cell">
        <div class="kpi-label"><span class="kpi-logo" style="color:#60a5fa">${SVG_AG}</span><span>Antigravity 5h Reset</span></div>
        <div class="kpi-val num countdown" data-reset-ms="${agResetMs || ''}">${agResetMs ? escapeHtml(formatReset(ag.rolling_reset_at, offsetHours).split(' (')[0]) : '—'}</div>
        <div class="muted num">${agResetMs ? escapeHtml(formatLocalTime(agResetMs, offsetHours)) : '<span data-i18n="waitingNextCycle">Menunggu siklus berikutnya</span>'}</div>
      </div>
      <div class="kpi-cell">
        <div class="kpi-label"><span class="kpi-logo" style="color:#f0f6fc">${SVG_GH}</span><span>GitHub Copilot</span></div>
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

    <section class="pools">
      <div class="provider-card">
        <div class="pool-header">
          <div class="pool-title">
            <span class="provider-logo is-ag">${SVG_AG}</span>
            <span>Antigravity</span>
          </div>
          <span class="badge">${escapeHtml(ag?.plan_tier || 'Active')}</span>
        </div>
        <div class="subpools-grid">
          ${groupCards || '<div class="muted" data-i18n="noPoolData">Belum ada data pool kuota.</div>'}
        </div>
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

    if (tokInput) {
      tokInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') callApi('/api/automation/tick');
      });
    }

    async function callApi(path) {
      const out = document.getElementById('out');
      const btns = document.querySelectorAll('.actions .btn');
      btns.forEach((b) => { b.disabled = true; b.style.opacity = '0.6'; });
      out.style.display = 'block';
      out.textContent = 'Running...';
      try {
        const tok = tokInput.value.trim();
        if (tok) localStorage.setItem('qra_auth_token', tok);
        const res = await fetch(path, { method: 'POST', headers: { 'X-Auth-Token': tok } });
        const body = await res.json().catch(() => ({ status: res.status }));
        out.textContent = JSON.stringify(body, null, 2);
        if (res.ok) setTimeout(() => location.reload(), 1200);
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
