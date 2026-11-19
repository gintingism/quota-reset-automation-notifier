/**
 * Auto-Wake decision engine with 4 safety guards ported from
 * vscode-antigravity-cockpit (TriggerService.shouldTriggerOnReset).
 */

export const RESET_SAFETY_MARGIN_MS = 2 * 60 * 1000; // 2 minutes after previous resetAt
export const RESET_TRIGGER_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes between triggers
export const IDLE_CYCLE_COOLDOWN_MS = 5 * 60 * 60 * 1000; // 5h guard when API omits resetTime on 100% idle buckets
export const IDLE_5H_MIN_MS = 4.5 * 60 * 60 * 1000; // Rolling ~5h idle window lower bound (antigravity-usage)
export const IDLE_5H_MAX_MS = 5.5 * 60 * 60 * 1000; // Rolling ~5h idle window upper bound
export const IDLE_WEEKLY_MIN_MS = 6.95 * 24 * 60 * 60 * 1000; // Rolling ~7d idle window lower bound

/**
 * Check if current local time (shifted by offsetHours) falls inside "HH:MM-HH:MM".
 */
export function isWithinTimeWindow(windowStr, offsetHours = 7, nowMs = Date.now()) {
  if (!windowStr || !windowStr.includes('-')) return true;
  const [startStr, endStr] = windowStr.split('-').map((s) => s.trim());
  const parseMinutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  };
  const start = parseMinutes(startStr);
  const end = parseMinutes(endStr);
  if (start === null || end === null) return true;

  const shifted = new Date(nowMs + offsetHours * 3600 * 1000);
  const current = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();

  if (start <= end) {
    return current >= start && current <= end;
  }
  // Overnight window, e.g. "22:00-06:00"
  return current >= start || current <= end;
}

/**
 * Evaluate the 4 guards for whether a model should be woken up on reset:
 * 1. Quota is full (remainingFraction >= 1.0)
 * 2. Safety margin: now >= lastTriggeredResetAt + 2 min (bypassed if 5h resetTime is sliding forward in 4.5h-5.5h idle window)
 * 3. Cooldown: now - lastTriggerAt >= 10 min
 * 4. New cycle: resetTimeIso !== lastTriggeredResetAt
 */
export function shouldTriggerOnReset(modelSnapshot, wakeState, nowMs = Date.now()) {
  if (!modelSnapshot || modelSnapshot.remaining_fraction === null) {
    return { shouldTrigger: false, reason: 'no_quota_data' };
  }
  if (modelSnapshot.remaining_fraction < 1.0) {
    return { shouldTrigger: false, reason: 'not_full' };
  }

  const resetIso = modelSnapshot.reset_time_iso || null;
  const resetMs = resetIso ? Date.parse(resetIso) : NaN;
  const timeUntilResetMs = Number.isFinite(resetMs) ? resetMs - nowMs : null;

  if (modelSnapshot.window_type === 'WEEKLY' && Number.isFinite(resetMs)) {
    // Active weekly timer (< ~6.95d remaining) does not need wake; rolling ~7d idle at 100% can still wake.
    if (resetMs > nowMs + RESET_SAFETY_MARGIN_MS && timeUntilResetMs < IDLE_WEEKLY_MIN_MS) {
      return { shouldTrigger: false, reason: 'already_triggered_for_cycle' };
    }
  }

  const lastTriggerAt = wakeState?.lastTriggerAt;
  const inCooldown = typeof lastTriggerAt === 'number' && nowMs - lastTriggerAt < RESET_TRIGGER_COOLDOWN_MS;
  const lastResetIso = wakeState?.lastTriggeredResetAt ?? null;
  const lastResetMs = lastResetIso ? Date.parse(lastResetIso) : NaN;

  const isRollingIdle5h =
    modelSnapshot.window_type === '5H' &&
    timeUntilResetMs !== null &&
    timeUntilResetMs >= IDLE_5H_MIN_MS &&
    timeUntilResetMs <= IDLE_5H_MAX_MS;

  // If a 5h bucket is still 100% and its resetTime slid forward by >= cooldown (still rolling now+5h),
  // the previous wake did not start the timer; allow a retry once cooldown expires.
  const isSlidingUnstarted5h =
    isRollingIdle5h &&
    Number.isFinite(lastResetMs) &&
    Number.isFinite(resetMs) &&
    resetMs >= lastResetMs + RESET_TRIGGER_COOLDOWN_MS;

  if (lastResetIso && !isSlidingUnstarted5h) {
    if (Number.isFinite(lastResetMs) && nowMs < lastResetMs + RESET_SAFETY_MARGIN_MS) {
      return { shouldTrigger: false, reason: 'safety_margin' };
    }
    if (resetIso && resetIso === lastResetIso) {
      return { shouldTrigger: false, reason: 'already_triggered_for_cycle' };
    }
  }

  if (typeof lastTriggerAt === 'number') {
    if (inCooldown) {
      return { shouldTrigger: false, reason: 'cooldown_active' };
    }
    // Cloud Code omits resetTime on idle 100% buckets; prevent re-waking within the same cycle.
    const idleCooldownMs =
      modelSnapshot.window_type === 'WEEKLY' ? 7 * 24 * 3600 * 1000 : IDLE_CYCLE_COOLDOWN_MS;
    if (!resetIso && wakeState?.lastTriggeredResetAt === null && nowMs - lastTriggerAt < idleCooldownMs) {
      return { shouldTrigger: false, reason: 'already_triggered_for_cycle' };
    }
  }

  if (isSlidingUnstarted5h) {
    return { shouldTrigger: true, reason: 'idle_5h_rolling' };
  }

  return { shouldTrigger: true, reason: 'all_guards_passed' };
}
