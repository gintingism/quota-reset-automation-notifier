/**
 * GitHub Copilot AI Credits & quota fetcher (monitoring + alerts, no Auto-Wake needed).
 */

const COPILOT_USER_ENDPOINT = 'https://api.github.com/copilot_internal/user';

export function parseCopilotUserResponse(data, nowSec = Math.floor(Date.now() / 1000)) {
  const snapshots = data?.quota_snapshots || data?.quotaSnapshots || {};
  const models = [];

  for (const [name, item] of Object.entries(snapshots)) {
    if (!item || typeof item !== 'object') continue;
    const pct = item.percent_remaining ?? item.percentRemaining;
    if (typeof pct === 'number' && Number.isFinite(pct)) {
      models.push({
        name,
        remaining_percent: Math.round(pct),
        percent_remaining: Number(pct.toFixed(1)),
        unlimited: Boolean(item.unlimited),
        credits_used: item.credits_used ?? null,
        credits_remaining: item.quota_remaining ?? item.remaining ?? null,
        credits_entitlement: item.entitlement ?? null,
      });
    }
  }

  const primary =
    models.find((m) => m.name === 'premium_interactions') ||
    models.find((m) => !m.unlimited) ||
    models[0] ||
    null;

  const resetStr = data?.quota_reset_date_utc || data?.quota_reset_date || null;
  const resetAt = resetStr ? Math.floor(Date.parse(resetStr) / 1000) : null;
  const pctRemaining = primary ? primary.percent_remaining : null;

  return {
    quota_percent: primary ? primary.remaining_percent : null,
    percent_remaining: pctRemaining,
    percent_used: pctRemaining === null ? null : Number((100 - pctRemaining).toFixed(1)),
    credits_used: primary?.credits_used ?? null,
    credits_remaining: primary?.credits_remaining ?? null,
    credits_entitlement: primary?.credits_entitlement ?? null,
    reset_at: Number.isFinite(resetAt) ? resetAt : null,
    reset_time_iso: resetStr,
    models,
    plan_tier: data?.access_type_sku || data?.copilot_plan || null,
    token_based_billing: Boolean(data?.token_based_billing),
    source: 'remote',
    estimated: false,
    fetched_at: nowSec,
  };
}

export async function fetchCopilotQuota(token) {
  if (!token) return null;

  const res = await fetch(COPILOT_USER_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Editor-Version': 'vscode/1.99.0',
      'User-Agent': 'quota-reset-automation-notifier/1.0',
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    return {
      quota_percent: null,
      reset_at: null,
      models: [],
      source: 'remote',
      estimated: false,
      error: `Copilot HTTP ${res.status}`,
      fetched_at: Math.floor(Date.now() / 1000),
    };
  }

  const data = await res.json();
  return parseCopilotUserResponse(data);
}
