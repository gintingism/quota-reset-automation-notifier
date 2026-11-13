/**
 * Optional GitHub Copilot quota fetcher (ported from quota-reset-notifier).
 */

const COPILOT_USER_ENDPOINT = 'https://api.github.com/copilot_internal/user';

export async function fetchCopilotQuota(token) {
  if (!token) return null;

  const res = await fetch(COPILOT_USER_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Editor-Version': 'vscode/1.99.0',
      'User-Agent': 'quota-reset-automation/1.0',
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
  const snapshots = data.quota_snapshots || data.quotaSnapshots || {};
  const models = [];

  for (const [name, item] of Object.entries(snapshots)) {
    if (!item || typeof item !== 'object') continue;
    const pct = item.percent_remaining ?? item.percentRemaining;
    if (typeof pct === 'number' && Number.isFinite(pct)) {
      models.push({ name, remaining_percent: Math.round(pct) });
    }
  }

  const primary =
    models.find((m) => m.name === 'premium_interactions') || models[0] || null;
  const resetStr = data.quota_reset_date_utc || data.quota_reset_date;
  const resetAt = resetStr ? Math.floor(Date.parse(resetStr) / 1000) : null;

  return {
    quota_percent: primary ? primary.remaining_percent : null,
    reset_at: Number.isFinite(resetAt) ? resetAt : null,
    models,
    plan_tier: data.copilot_plan || null,
    source: 'remote',
    estimated: false,
    fetched_at: Math.floor(Date.now() / 1000),
  };
}
