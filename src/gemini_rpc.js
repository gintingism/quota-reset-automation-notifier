/**
 * Pure parser for Google Gemini batchexecute RPC (`jSf9Qc` quota windows & `otAQ7b` plan policy)
 * and burn-rate / depletion forecast math.
 */

export const GEMINI_PLAN_MAP = {
  1: 'Free',
  2: 'Work',
  3: 'AI Plus',
  4: 'AI Plus',
  5: 'AI Pro',
  6: 'AI Ultra',
};

export const GEMINI_POLICY_TIER = {
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

export function decodeBatchExecuteEnvelope(rawText, rpcId) {
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
      // Ignore non-JSON framing lines
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

export function resolveGeminiPlanTier(planId, otPayload = null) {
  const policies = collectPolicies(otPayload, []);
  for (const p of policies) {
    if (GEMINI_POLICY_TIER[p]) return GEMINI_POLICY_TIER[p];
  }
  return GEMINI_PLAN_MAP[planId] || 'AI Pro';
}

export function parseGeminiRpcWindows(jSf9QcPayload, otPayload = null) {
  if (!Array.isArray(jSf9QcPayload) || !Array.isArray(jSf9QcPayload[1])) return null;
  const planId = jSf9QcPayload[0];
  const windows = jSf9QcPayload[1];

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
    planTier: resolveGeminiPlanTier(planId, otPayload),
    dailyUsed,
    dailyResetAt,
    remaining5h,
    weeklyUsed,
    weeklyResetAt,
    remaining7d,
  };
}

/**
 * Calculates burn-rate pace and estimates whether quota will exhaust before reset.
 * @param {number} usedPct - Percentage used (0..100)
 * @param {number} resetAtMs - Target reset timestamp in epoch ms
 * @param {number} windowHours - Window duration in hours (e.g. 5, 168, 720)
 * @param {number} [nowMs=Date.now()] - Current epoch ms
 */
export function computeBurnRateForecast(usedPct, resetAtMs, windowHours, nowMs = Date.now()) {
  if (!Number.isFinite(usedPct) || !Number.isFinite(resetAtMs) || resetAtMs <= nowMs || windowHours <= 0) {
    return null;
  }
  const totalMs = windowHours * 3600 * 1000;
  const remainingMs = Math.max(0, resetAtMs - nowMs);
  if (remainingMs > totalMs) return null;

  const elapsedMs = Math.max(0, totalMs - remainingMs);
  const elapsedPct = Math.min(100, Math.round((elapsedMs / totalMs) * 100));
  const deltaPct = Math.round(usedPct - elapsedPct);

  // Need at least 3 minutes elapsed and some usage to project depletion time
  if (usedPct <= 0 || elapsedMs < 3 * 60 * 1000) {
    return {
      elapsedPct,
      deltaPct,
      willExhaustBeforeReset: false,
      depletionMs: null,
      status: 'on_track',
    };
  }

  const ratePerMs = usedPct / elapsedMs;
  const remainingPct = Math.max(0, 100 - usedPct);
  const depletionMs = remainingPct / ratePerMs;
  const willExhaustBeforeReset = depletionMs < remainingMs;

  return {
    elapsedPct,
    deltaPct,
    willExhaustBeforeReset,
    depletionMs: Math.round(depletionMs),
    status: willExhaustBeforeReset ? 'over_pace' : 'on_track',
  };
}
