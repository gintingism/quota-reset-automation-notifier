/**
 * Lightweight HTML dashboard rendered from the latest KV snapshot (no secrets exposed).
 */

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

  const groupCards = groups
    .map((g) => {
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
        <div class="subpool-card">
          <div class="subpool-title"><i data-lucide="box"></i><span>${escapeHtml(g.name)}</span></div>
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
    ? `<div class="card pool-card">
        <div class="pool-header">
          <div class="pool-title"><i data-lucide="github"></i><span>GitHub Copilot</span></div>
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
  const geminiCard = geminiWeb
    ? `<div class="card pool-card">
        <div class="pool-header">
          <div class="pool-title"><i data-lucide="sparkles"></i><span>Google Gemini Web</span></div>
          <span class="muted">Extension Sync</span>
        </div>
        <div class="win-row">
          <div class="win-info">
            <div class="win-label" data-i18n="geminiSession">Sesi 5h / Saat ini</div>
            <div class="muted num">Reset: ${escapeHtml(geminiWeb.daily_reset_label || '—')} <span class="gemini-countdown" data-gemini-label="${escapeHtml(geminiWeb.daily_reset_label || '')}" data-gemini-kind="daily"></span> · ${geminiWeb.daily_used ?? '—'}% <span data-i18n="usedWord">terpakai</span></div>
          </div>
          <div class="win-right">
            <div class="bar-wrap"><div class="bar" style="width:${geminiDailyLeft}%;background:${barColor(geminiDailyLeft)}"></div></div>
            <span class="badge num ${toneClass(geminiDailyLeft)}">${geminiDailyLeft}%</span>
          </div>
        </div>
        <div class="win-row">
          <div class="win-info">
            <div class="win-label" data-i18n="geminiWeekly">Batas Mingguan</div>
            <div class="muted num">Reset: ${escapeHtml(geminiWeb.weekly_reset_label || '—')} <span class="gemini-countdown" data-gemini-label="${escapeHtml(geminiWeb.weekly_reset_label || '')}" data-gemini-kind="weekly"></span> · ${geminiWeb.weekly_used ?? '—'}% <span data-i18n="usedWord">terpakai</span></div>
          </div>
          <div class="win-right">
            <div class="bar-wrap"><div class="bar" style="width:${geminiWeeklyLeft}%;background:${barColor(geminiWeeklyLeft)}"></div></div>
            <span class="badge num ${toneClass(geminiWeeklyLeft)}">${geminiWeeklyLeft}%</span>
          </div>
        </div>
      </div>`
    : '';

  const lastWake = wakeState?.lastWakeResult
    ? `<strong>${escapeHtml(wakeState.lastWakeResult.model)}</strong> · <span class="rel-time" data-iso="${escapeHtml(wakeState.lastWakeResult.triggeredAt)}">${escapeHtml(wakeState.lastWakeResult.triggeredAt)}</span><br><span class="muted"><span data-i18n="replyLabel">Balasan</span>: "${escapeHtml(wakeState.lastWakeResult.reply)}"</span>`
    : `<span class="muted" data-i18n="noWakeYet">Belum ada riwayat auto-wake</span>`;

  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Quota Reset Automation</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0c0f14;
      --surface: #131820;
      --surface-inset: #1a212d;
      --border: #232b38;
      --border-strong: #2f3a4a;
      --text: #e6edf3;
      --muted: #8b949e;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --ok: #10b981;
      --warn: #f59e0b;
      --danger: #ef4444;
      --ease: cubic-bezier(0.2, 0, 0, 1);
    }
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 24px 16px 40px;
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
    }
    .wrap { max-width: 900px; margin: 0 auto; }
    .num { font-variant-numeric: tabular-nums; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.78rem; }

    /* Header */
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 18px;
    }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand-mark {
      width: 34px; height: 34px;
      border-radius: 8px;
      background: var(--surface);
      border: 1px solid var(--border);
      display: grid; place-items: center;
      color: var(--accent);
    }
    h1 { font-size: 1.25rem; font-weight: 650; letter-spacing: -0.02em; margin: 0; }
    .subline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px; font-size: 0.82rem; color: var(--muted); }
    .top-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pill {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 10px;
      border-radius: 8px;
      background: var(--surface);
      border: 1px solid var(--border);
      font-size: 0.78rem;
      color: var(--muted);
    }
    .dot { width: 7px; height: 7px; border-radius: 999px; background: var(--ok); }

    /* Language Switch */
    .lang-switch {
      display: inline-flex;
      padding: 3px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      gap: 2px;
    }
    .lang-btn {
      border: 0;
      background: transparent;
      color: var(--muted);
      padding: 3px 8px;
      border-radius: 5px;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 150ms var(--ease), color 150ms var(--ease), transform 150ms var(--ease);
    }
    .lang-btn:hover { color: var(--text); }
    .lang-btn.is-active { background: var(--surface-inset); color: var(--text); }
    .lang-btn:active { transform: scale(0.96); }

    /* Summary Grid */
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 16px;
    }
    .kpi-label { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--muted); font-weight: 500; }
    .kpi-val { font-size: 1.45rem; font-weight: 700; letter-spacing: -0.02em; margin: 6px 0 3px; }
    .muted { color: var(--muted); font-size: 0.8rem; }

    /* Provider Sections & Pools */
    .pools { display: flex; flex-direction: column; gap: 14px; margin-bottom: 16px; }
    .provider-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
    }
    .pool-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 8px; }
    .pool-title { display: inline-flex; align-items: center; gap: 8px; font-size: 1rem; font-weight: 650; }
    .subpools-grid { display: flex; flex-direction: column; gap: 10px; }
    .subpool-card {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 14px;
    }
    .subpool-title {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.88rem; font-weight: 650; color: var(--text);
      margin-bottom: 6px;
    }
    .win-row {
      display: flex; justify-content: space-between; align-items: center;
      gap: 14px; padding: 9px 0;
      border-top: 1px solid var(--border);
    }
    .win-info { min-width: 0; }
    .win-label { font-size: 0.85rem; font-weight: 600; margin-bottom: 2px; }
    .win-right { display: flex; align-items: center; gap: 9px; flex-shrink: 0; }
    .bar-wrap { width: 100px; height: 7px; background: var(--surface-inset); border-radius: 999px; overflow: hidden; }
    .bar { height: 100%; border-radius: 999px; }

    .badge {
      padding: 2px 7px; border-radius: 6px;
      font-size: 0.76rem; font-weight: 600;
      background: var(--surface-inset); color: var(--muted);
      border: 1px solid var(--border);
    }
    .badge.is-ok { color: var(--ok); border-color: rgba(16, 185, 129, 0.28); }
    .badge.is-warn { color: var(--warn); border-color: rgba(245, 158, 11, 0.28); }
    .badge.is-danger { color: var(--danger); border-color: rgba(239, 68, 68, 0.28); }

    /* Details Table inside Antigravity */
    details { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); }
    summary {
      display: inline-flex; align-items: center; gap: 6px;
      cursor: pointer; color: var(--muted); font-size: 0.83rem; font-weight: 500;
    }
    summary:hover { color: var(--text); }
    .table-tools { margin: 10px 0 8px; }
    .table-wrap { overflow-x: auto; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
    tr:last-child td { border-bottom: 0; }
    th { color: var(--muted); font-weight: 600; font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.04em; background: var(--surface-inset); }

    /* Controls */
    .actions {
      display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
      padding: 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
    }
    .input-wrap { position: relative; flex: 1; min-width: 190px; display: flex; align-items: center; }
    input {
      width: 100%;
      background: var(--bg); color: var(--text);
      border: 1px solid var(--border); border-radius: 8px;
      padding: 8px 34px 8px 11px; font-size: 0.85rem; outline: none;
      transition: border-color 150ms var(--ease);
    }
    input:focus { border-color: var(--accent); }
    .eye-btn {
      position: absolute; right: 6px; width: 24px; height: 24px; padding: 0;
      border: 0; background: transparent; color: var(--muted);
      display: grid; place-items: center; cursor: pointer;
    }
    .eye-btn:hover { color: var(--text); }
    .btn {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--accent); border: 1px solid transparent; color: #fff;
      border-radius: 8px; padding: 8px 13px; font-size: 0.85rem; font-weight: 600;
      cursor: pointer;
      transition: background-color 150ms var(--ease), transform 150ms var(--ease), opacity 150ms var(--ease);
    }
    .btn:hover { background: var(--accent-hover); }
    .btn:active { transform: scale(0.96); }
    .btn.sec { background: var(--surface-inset); border-color: var(--border-strong); color: var(--text); }
    .btn.sec:hover { background: #222b3a; }
    pre {
      background: var(--surface); border: 1px solid var(--border);
      padding: 12px; border-radius: 10px; font-size: 0.78rem; overflow: auto;
      display: none; margin-top: 10px;
    }
    svg.lucide { width: 15px; height: 15px; stroke-width: 1.85; flex-shrink: 0; }
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
          <button type="button" class="lang-btn is-active" data-lang="id">ID</button>
          <button type="button" class="lang-btn" data-lang="en">EN</button>
        </div>
      </div>
    </header>

    <section class="grid">
      <div class="card">
        <div class="kpi-label"><i data-lucide="timer"></i><span>Antigravity 5h Reset</span></div>
        <div class="kpi-val num countdown" data-reset-ms="${agResetMs || ''}">${agResetMs ? escapeHtml(formatReset(ag.rolling_reset_at, offsetHours).split(' (')[0]) : '—'}</div>
        <div class="muted num">${agResetMs ? escapeHtml(formatLocalTime(agResetMs, offsetHours)) : '<span data-i18n="waitingNextCycle">Menunggu siklus berikutnya</span>'}</div>
      </div>
      <div class="card">
        <div class="kpi-label"><i data-lucide="cpu"></i><span>GitHub Copilot</span></div>
        <div class="kpi-val num">${copilot?.quota_percent ?? '—'}%</div>
        <div class="muted num">${
          copilot?.error
            ? escapeHtml(copilot.error)
            : copilotResetMs
              ? `<span data-i18n="resetsIn">Reset dalam</span> <span class="countdown" data-reset-ms="${copilotResetMs}">${escapeHtml(formatReset(copilot.reset_at, offsetHours).split(' (')[0])}</span>`
              : `<span data-i18n="inactive">Tidak aktif</span>`
        }</div>
      </div>
      <div class="card">
        <div class="kpi-label"><i data-lucide="zap"></i><span data-i18n="lastWakeTitle">Auto-Wake Terakhir</span></div>
        <div style="font-size:0.86rem;margin-top:8px;">${lastWake}</div>
      </div>
    </section>

    <section class="pools">
      <div class="provider-card">
        <div class="pool-header">
          <div class="pool-title"><i data-lucide="layers"></i><span>Antigravity</span></div>
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
      ${copilotCard}
      ${geminiCard}
    </section>

    <section class="actions">
      <div class="input-wrap">
        <input id="tok" type="password" data-i18n-placeholder="tokenPlaceholder" placeholder="Contoh: qra-9f4a2c8e..." aria-label="X-Auth-Token" autocomplete="off" />
        <button id="toggleTok" type="button" class="eye-btn" title="Tampilkan token"><i data-lucide="eye"></i></button>
      </div>
      <button class="btn" type="button" onclick="callApi('/api/automation/tick')"><i data-lucide="refresh-cw"></i><span data-i18n="btnSyncTick">Jalankan sinkronisasi</span></button>
      <button class="btn sec" type="button" onclick="callApi('/api/automation/wake')"><i data-lucide="zap"></i><span data-i18n="btnForceWake">Kirim wake sekarang</span></button>
    </section>
    <pre id="out"></pre>
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
        btn.classList.toggle('is-active', btn.dataset.lang === currentLang);
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

    async function callApi(path) {
      const out = document.getElementById('out');
      out.style.display = 'block';
      out.textContent = 'Running...';
      const tok = tokInput.value.trim();
      if (tok) localStorage.setItem('qra_auth_token', tok);
      const res = await fetch(path, { method: 'POST', headers: { 'X-Auth-Token': tok } });
      out.textContent = JSON.stringify(await res.json(), null, 2);
      if (res.ok) setTimeout(() => location.reload(), 1200);
    }
  </script>
</body>
</html>`;
}
