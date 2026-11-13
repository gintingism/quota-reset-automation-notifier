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

function formatReset(isoOrEpoch, offsetHours = 7) {
  if (!isoOrEpoch) return '—';
  const ms = typeof isoOrEpoch === 'number' ? isoOrEpoch * 1000 : Date.parse(isoOrEpoch);
  if (!Number.isFinite(ms)) return '—';
  const diffMin = Math.max(0, Math.round((ms - Date.now()) / 60000));
  const d = Math.floor(diffMin / 1440);
  const h = Math.floor((diffMin % 1440) / 60);
  const m = diffMin % 60;
  const rel = d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
  const local = new Date(ms + offsetHours * 3600 * 1000).toISOString().replace('T', ' ').slice(5, 16);
  return `${rel} (${local} UTC+${offsetHours})`;
}

function barColor(pct) {
  if (pct <= 20) return '#ef4444';
  if (pct <= 50) return '#f59e0b';
  return '#10b981';
}

export function renderDashboardHtml(latest, wakeState, offsetHours = 7) {
  const ag = latest?.providers?.antigravity;
  const copilot = latest?.providers?.github_copilot;
  const geminiWeb = latest?.providers?.gemini_web;
  const groups = Array.isArray(ag?.groups) ? ag.groups : [];
  const models = Array.isArray(ag?.models) ? ag.models : [];

  const groupCards = groups
    .map((g) => {
      const windowsHtml = (g.windows || [])
        .map((w) => {
          const pct = w.remaining_percent ?? 0;
          return `
            <div class="win-row">
              <div>
                <div class="win-label">${escapeHtml(w.label)}</div>
                <div class="muted">${w.reset_at ? `Resets in ${escapeHtml(formatReset(w.reset_at, offsetHours))}` : 'Ready / full'}</div>
              </div>
              <div class="win-right">
                <div class="bar-wrap"><div class="bar" style="width:${pct}%;background:${barColor(pct)}"></div></div>
                <span class="pct">${pct}% left</span>
              </div>
            </div>`;
        })
        .join('');

      return `
        <div class="card pool-card">
          <div class="pool-title">${escapeHtml(g.name)}</div>
          ${windowsHtml}
        </div>`;
    })
    .join('');

  const modelRows = models
    .map((m) => {
      const pct = m.remaining_percent ?? 0;
      return `
        <tr>
          <td><strong>${escapeHtml(m.name)}</strong><br><span class="muted">${escapeHtml(m.id)}</span></td>
          <td>
            <div class="bar-wrap"><div class="bar" style="width:${pct}%;background:${barColor(pct)}"></div></div>
            <span class="pct">${m.remaining_percent === null ? '—' : `${pct}%`}</span>
          </td>
          <td>${escapeHtml(formatReset(m.reset_at, offsetHours))}</td>
        </tr>`;
    })
    .join('');

  const copilotCard = copilot
    ? `<div class="card pool-card">
        <div class="pool-title">GitHub Copilot <span class="muted">(${escapeHtml(copilot.plan_tier || 'individual')})</span></div>
        <div class="win-row">
          <div>
            <div class="win-label">AI credits (resets monthly)</div>
            <div class="muted">${
              copilot.error
                ? escapeHtml(copilot.error)
                : `${copilot.credits_used ?? '—'} used · ${copilot.credits_remaining ?? '—'} / ${copilot.credits_entitlement ?? '—'} left · Resets in ${escapeHtml(formatReset(copilot.reset_at, offsetHours))}`
            }</div>
          </div>
          <div class="win-right">
            <div class="bar-wrap"><div class="bar" style="width:${copilot.percent_remaining ?? copilot.quota_percent ?? 0}%;background:${barColor(copilot.percent_remaining ?? copilot.quota_percent ?? 0)}"></div></div>
            <span class="pct">${copilot.percent_remaining ?? copilot.quota_percent ?? '—'}% left</span>
          </div>
        </div>
      </div>`
    : '';

  const geminiWebCard = geminiWeb
    ? `<div class="card pool-card">
        <div class="pool-title">Google Gemini Web <span class="muted">(gemini.google.com · synced via extension)</span></div>
        <div class="win-row">
          <div>
            <div class="win-label">Penggunaan saat ini (5h/session)</div>
            <div class="muted">${escapeHtml(geminiWeb.daily_reset_label || '—')} · ${geminiWeb.daily_used ?? '—'}% used</div>
          </div>
          <div class="win-right">
            <div class="bar-wrap"><div class="bar" style="width:${100 - (geminiWeb.daily_used ?? 0)}%;background:${barColor(100 - (geminiWeb.daily_used ?? 0))}"></div></div>
            <span class="pct">${100 - (geminiWeb.daily_used ?? 0)}% left</span>
          </div>
        </div>
        <div class="win-row">
          <div>
            <div class="win-label">Batas mingguan</div>
            <div class="muted">${escapeHtml(geminiWeb.weekly_reset_label || '—')} · ${geminiWeb.weekly_used ?? '—'}% used</div>
          </div>
          <div class="win-right">
            <div class="bar-wrap"><div class="bar" style="width:${100 - (geminiWeb.weekly_used ?? 0)}%;background:${barColor(100 - (geminiWeb.weekly_used ?? 0))}"></div></div>
            <span class="pct">${100 - (geminiWeb.weekly_used ?? 0)}% left</span>
          </div>
        </div>
      </div>`
    : '';

  const lastWake = wakeState?.lastWakeResult
    ? `${escapeHtml(wakeState.lastWakeResult.model)} at ${escapeHtml(wakeState.lastWakeResult.triggeredAt)} — "${escapeHtml(wakeState.lastWakeResult.reply)}"`
    : 'Belum ada auto-wake';

  const updatedAt = latest?.fetched_at
    ? new Date(latest.fetched_at * 1000 + offsetHours * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) + ` UTC+${offsetHours}`
    : 'Belum ada data';

  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Quota Reset Automation</title>
  <style>
    :root { color-scheme: dark; --bg:#0b0f17; --card:#121826; --border:#1f2937; --text:#e5e7eb; --muted:#9ca3af; }
    body { margin:0; font-family:system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--text); padding:24px; }
    .wrap { max-width:860px; margin:0 auto; }
    h1 { font-size:1.35rem; margin:0 0 6px; }
    .muted { color:var(--muted); font-size:0.82rem; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; margin:16px 0; }
    .card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:14px 16px; }
    .val { font-size:1.55rem; font-weight:700; margin-top:4px; }
    .pools { display:flex; flex-direction:column; gap:12px; margin:16px 0; }
    .pool-title { font-size:1rem; font-weight:700; margin-bottom:10px; }
    .win-row { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 0; border-top:1px solid var(--border); }
    .win-label { font-size:0.9rem; font-weight:600; }
    .win-right { display:flex; align-items:center; gap:8px; white-space:nowrap; }
    details { margin-top:14px; }
    summary { cursor:pointer; color:var(--muted); font-size:0.88rem; margin-bottom:8px; }
    table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
    th,td { text-align:left; padding:10px 14px; border-bottom:1px solid var(--border); font-size:0.88rem; }
    th { color:var(--muted); font-weight:600; font-size:0.78rem; text-transform:uppercase; }
    .bar-wrap { width:96px; height:8px; background:#1f2937; border-radius:999px; display:inline-block; vertical-align:middle; overflow:hidden; }
    .bar { height:100%; border-radius:999px; }
    .pct { font-variant-numeric:tabular-nums; font-weight:600; font-size:0.9rem; }
    .actions { display:flex; gap:8px; margin-top:16px; flex-wrap:wrap; }
    input,button { background:var(--card); color:var(--text); border:1px solid var(--border); border-radius:8px; padding:8px 12px; font-size:0.88rem; }
    button { background:#2563eb; border-color:#2563eb; cursor:pointer; font-weight:600; }
    button.sec { background:#1f2937; border-color:#374151; }
    pre { background:var(--card); border:1px solid var(--border); padding:10px; border-radius:8px; font-size:0.8rem; overflow:auto; display:none; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Quota Reset Automation</h1>
    <div class="muted">Last sync: ${escapeHtml(updatedAt)} | Tier: ${escapeHtml(ag?.plan_tier || '—')} | Cron: every 5m</div>

    <div class="grid">
      <div class="card">
        <div class="muted">Antigravity 5h Reset</div>
        <div class="val">${ag?.rolling_reset_at ? escapeHtml(formatReset(ag.rolling_reset_at, offsetHours).split(' (')[0]) : '—'}</div>
        <div class="muted">${ag?.rolling_reset_at ? escapeHtml(formatReset(ag.rolling_reset_at, offsetHours)) : 'Belum ada data'}</div>
      </div>
      <div class="card">
        <div class="muted">GitHub Copilot</div>
        <div class="val">${copilot?.quota_percent ?? '—'}%</div>
        <div class="muted">${copilot?.error ? escapeHtml(copilot.error) : escapeHtml(formatReset(copilot?.reset_at, offsetHours))}</div>
      </div>
      <div class="card">
        <div class="muted">Last Auto-Wake</div>
        <div style="font-size:0.86rem;margin-top:6px;">${lastWake}</div>
      </div>
    </div>

    <div class="pools">
      ${groupCards || '<div class="card muted">Belum ada data pool kuota.</div>'}
      ${copilotCard}
      ${geminiWebCard}
    </div>

    <details>
      <summary>Detail Semua Model (${models.length})</summary>
      <table>
        <thead><tr><th>Model</th><th>Remaining</th><th>Reset In</th></tr></thead>
        <tbody>${modelRows || '<tr><td colspan="3" class="muted">Belum ada data model.</td></tr>'}</tbody>
      </table>
    </details>

    <div class="actions">
      <input id="tok" type="password" placeholder="X-Auth-Token" />
      <button onclick="callApi('/api/automation/tick')">Run Sync Tick</button>
      <button class="sec" onclick="callApi('/api/automation/wake')">Force Wake Now</button>
    </div>
    <pre id="out"></pre>
  </div>
  <script>
    async function callApi(path) {
      const out = document.getElementById('out');
      out.style.display = 'block';
      out.textContent = 'Running...';
      const tok = document.getElementById('tok').value;
      const res = await fetch(path, { method: 'POST', headers: { 'X-Auth-Token': tok } });
      out.textContent = JSON.stringify(await res.json(), null, 2);
      if (res.ok) setTimeout(() => location.reload(), 1200);
    }
  </script>
</body>
</html>`;
}
