/**
 * Compact rolling quota history (24h ring buffer) and inline SVG sparkline / burn-rate analytics.
 */

export const HISTORY_KEY = 'history:quota';
export const MAX_HISTORY_POINTS = 96;
export const MIN_SAMPLE_INTERVAL_MS = 15 * 60 * 1000;
const SIGNIFICANT_DELTA_PCT = 5;

function findWindowRemaining(groups, groupMatch, windowType) {
  if (!Array.isArray(groups)) return null;
  const g = groups.find((item) => groupMatch(String(item?.name || '').toLowerCase()));
  if (!g || !Array.isArray(g.windows)) return null;
  const w = g.windows.find(
    (win) => win.window_type === windowType || (windowType === '5H' ? /5h/i.test(win.label || '') : /week/i.test(win.label || '')),
  );
  return typeof w?.remaining_percent === 'number' && Number.isFinite(w.remaining_percent)
    ? Math.max(0, Math.min(100, Math.round(w.remaining_percent)))
    : null;
}

export function extractHistorySample(snapshot, nowMs = Date.now()) {
  const ag = snapshot?.providers?.antigravity;
  const gw = snapshot?.providers?.gemini_web;
  const copilot = snapshot?.providers?.github_copilot;
  const groups = ag?.groups || [];

  const gw5h = typeof gw?.daily_used === 'number' ? Math.max(0, Math.min(100, Math.round(100 - gw.daily_used))) : null;
  const copPct =
    copilot && !copilot.error && typeof (copilot.percent_remaining ?? copilot.quota_percent) === 'number'
      ? Math.max(0, Math.min(100, Math.round(copilot.percent_remaining ?? copilot.quota_percent)))
      : null;

  return {
    t: Math.floor(nowMs / 1000),
    ag_gem_5h: findWindowRemaining(groups, (n) => n.includes('gemini') && !n.includes('argon'), '5H'),
    ag_gem_w: findWindowRemaining(groups, (n) => n.includes('gemini') && !n.includes('argon'), 'WEEKLY'),
    ag_cg_5h: findWindowRemaining(groups, (n) => n.includes('claude') || n.includes('gpt'), '5H'),
    ag_cg_w: findWindowRemaining(groups, (n) => n.includes('claude') || n.includes('gpt'), 'WEEKLY'),
    gw_5h: gw5h,
    copilot: copPct,
  };
}

function hasSignificantDelta(prev, next) {
  const keys = ['ag_gem_5h', 'ag_gem_w', 'ag_cg_5h', 'ag_cg_w', 'gw_5h', 'copilot'];
  return keys.some((k) => {
    if (prev[k] === null && next[k] === null) return false;
    if (prev[k] === null || next[k] === null) return true;
    return Math.abs(next[k] - prev[k]) >= SIGNIFICANT_DELTA_PCT;
  });
}

/**
 * Append a new sample if interval >= 15m or any quota changed by >= 5%.
 * Returns { points, changed }.
 */
export function appendHistoryPoint(existing, snapshot, nowMs = Date.now()) {
  const points = Array.isArray(existing) ? existing.slice() : [];
  const sample = extractHistorySample(snapshot, nowMs);
  const hasAnyValue = ['ag_gem_5h', 'ag_cg_5h', 'gw_5h', 'copilot'].some((k) => sample[k] !== null);
  if (!hasAnyValue) return { points, changed: false };

  const last = points[points.length - 1];
  if (last) {
    const elapsedMs = (sample.t - last.t) * 1000;
    if (elapsedMs < MIN_SAMPLE_INTERVAL_MS && !hasSignificantDelta(last, sample)) {
      return { points, changed: false };
    }
  }

  points.push(sample);
  const trimmed = points.length > MAX_HISTORY_POINTS ? points.slice(points.length - MAX_HISTORY_POINTS) : points;
  return { points: trimmed, changed: true };
}

/**
 * Compute recent burn rate (%/hour) from the latest monotonic drop segment (ignoring resets).
 */
export function computeSeriesBurnRate(points, key) {
  const valid = (Array.isArray(points) ? points : []).filter((p) => typeof p?.[key] === 'number');
  if (valid.length < 2) {
    return { current: valid[valid.length - 1]?.[key] ?? null, pctPerHour: 0, etaHours: null, status: 'insufficient' };
  }

  const latest = valid[valid.length - 1];
  // Walk back until a reset jump (+10% or more) or up to 6 hours back
  const windowCutoffSec = latest.t - 6 * 3600;
  let start = latest;
  for (let i = valid.length - 2; i >= 0; i--) {
    const prev = valid[i];
    if (prev.t < windowCutoffSec) break;
    // If previous value was much lower than next, a reset occurred — stop at the post-reset high
    if (valid[i + 1][key] - prev[key] >= 10) break;
    start = prev;
  }

  const dtHours = (latest.t - start.t) / 3600;
  const drop = start[key] - latest[key];
  if (dtHours < 0.08 || drop <= 0) {
    return { current: latest[key], pctPerHour: 0, etaHours: null, status: 'steady' };
  }

  const pctPerHour = Math.round((drop / dtHours) * 10) / 10;
  const etaHours = pctPerHour > 0 ? Math.round((latest[key] / pctPerHour) * 10) / 10 : null;
  const status = etaHours !== null && etaHours <= 2 ? 'fast' : 'burning';
  return { current: latest[key], pctPerHour, etaHours, status };
}

/**
 * Render a lightweight, dependency-free inline SVG sparkline for a quota metric (0..100%).
 */
export function renderSparklineSvg(points, key, color = '#5e6ad2', label = 'Quota trend', width = 220, height = 44) {
  const valid = (Array.isArray(points) ? points : []).filter((p) => typeof p?.[key] === 'number');
  if (valid.length < 2) {
    return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}"><line x1="2" y1="${height / 2}" x2="${width - 2}" y2="${height / 2}" stroke="#23252a" stroke-dasharray="3 3" stroke-width="1.5"/></svg>`;
  }

  const padX = 3;
  const padY = 4;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;
  const minT = valid[0].t;
  const spanT = Math.max(1, valid[valid.length - 1].t - minT);

  const coords = valid.map((p, idx) => {
    const x = valid.length === 1 ? padX : padX + ((p.t - minT) / spanT) * plotW;
    const clamped = Math.max(0, Math.min(100, p[key]));
    const y = padY + (1 - clamped / 100) * plotH;
    return [Number(x.toFixed(1)), Number(y.toFixed(1)), idx];
  });

  const linePts = coords.map(([x, y]) => `${x},${y}`).join(' ');
  const first = coords[0];
  const last = coords[coords.length - 1];
  const areaPts = `${first[0]},${height - padY} ${linePts} ${last[0]},${height - padY}`;

  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
    <polygon points="${areaPts}" fill="${color}" fill-opacity="0.12" />
    <polyline points="${linePts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="${color}" />
  </svg>`;
}
