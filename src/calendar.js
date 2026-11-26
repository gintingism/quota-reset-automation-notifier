/**
 * Google Calendar & Google Tasks sync for weekly (and optional monthly) quota resets.
 * Intentionally excludes 5h windows so calendars/tasks stay focused on long-cycle resets.
 */

export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks',
];

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GCAL_API_BASE = 'https://www.googleapis.com/calendar/v3';
const GTASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1';
const KV_GCAL_TOKEN_KEY = 'oauth:gcal_access_token';
const KV_CAL_SETTINGS_KEY = 'calendar:settings';
const KV_CAL_STATE_KEY = 'calendar:sync_state';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export const DEFAULT_CALENDAR_SETTINGS = {
  enabled: false,
  syncCalendar: true,
  syncTasks: false,
  includeAntigravityWeekly: true,
  includeGeminiWebWeekly: true,
  includeCopilotMonthly: false,
  allDay: false,
  calendarId: 'primary',
  taskListId: '@default',
  reminderMinutes: 15,
};

export function isGoogleCalendarConfigured(env) {
  return Boolean(env?.GCAL_CLIENT_ID && env?.GCAL_CLIENT_SECRET && env?.GCAL_REFRESH_TOKEN);
}

export function normalizeCalendarSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const bool = (val, fallback) => (typeof val === 'boolean' ? val : fallback);
  const rem = Number(src.reminderMinutes);
  const calendarId = typeof src.calendarId === 'string' && src.calendarId.trim() ? src.calendarId.trim() : 'primary';
  const taskListId = typeof src.taskListId === 'string' && src.taskListId.trim() ? src.taskListId.trim() : '@default';

  return {
    enabled: bool(src.enabled, DEFAULT_CALENDAR_SETTINGS.enabled),
    syncCalendar: bool(src.syncCalendar, DEFAULT_CALENDAR_SETTINGS.syncCalendar),
    syncTasks: bool(src.syncTasks, DEFAULT_CALENDAR_SETTINGS.syncTasks),
    includeAntigravityWeekly: bool(src.includeAntigravityWeekly, DEFAULT_CALENDAR_SETTINGS.includeAntigravityWeekly),
    includeGeminiWebWeekly: bool(src.includeGeminiWebWeekly, DEFAULT_CALENDAR_SETTINGS.includeGeminiWebWeekly),
    includeCopilotMonthly: bool(src.includeCopilotMonthly, DEFAULT_CALENDAR_SETTINGS.includeCopilotMonthly),
    allDay: bool(src.allDay, DEFAULT_CALENDAR_SETTINGS.allDay),
    calendarId,
    taskListId,
    reminderMinutes: Number.isFinite(rem) ? Math.max(0, Math.min(1440, Math.round(rem))) : DEFAULT_CALENDAR_SETTINGS.reminderMinutes,
  };
}

export async function loadCalendarSettings(kv) {
  if (!kv) return { ...DEFAULT_CALENDAR_SETTINGS };
  const stored = await kv.get(KV_CAL_SETTINGS_KEY, 'json');
  return normalizeCalendarSettings(stored);
}

export async function saveCalendarSettings(kv, raw) {
  const normalized = normalizeCalendarSettings(raw);
  if (kv) {
    await kv.put(KV_CAL_SETTINGS_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export async function loadCalendarSyncState(kv) {
  if (!kv) return { items: {}, lastSyncedAt: null };
  const stored = await kv.get(KV_CAL_STATE_KEY, 'json');
  return stored && typeof stored === 'object' ? { items: stored.items || {}, lastSyncedAt: stored.lastSyncedAt || null } : { items: {}, lastSyncedAt: null };
}

function toIsoFromValue(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number' && Number.isFinite(val)) {
    const ms = val > 1e12 ? val : val * 1000;
    return new Date(ms).toISOString();
  }
  const parsed = Date.parse(String(val));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function formatLocalDate(iso, offsetHours) {
  const ms = Date.parse(iso) + offsetHours * 3600 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

function nextDateString(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * Extract only weekly (and optional monthly Copilot) reset entries from a normalized snapshot.
 * 5h windows are always excluded.
 */
export function extractScheduledResets(snapshot, settings) {
  const cfg = normalizeCalendarSettings(settings);
  const providers = snapshot?.providers || {};
  const entries = [];

  if (cfg.includeAntigravityWeekly) {
    const agAccounts =
      Array.isArray(providers.antigravity_accounts) && providers.antigravity_accounts.length > 0
        ? providers.antigravity_accounts
        : providers.antigravity
          ? [{ id: 'primary', label: 'Primary', ...providers.antigravity }]
          : [];
    const multi = agAccounts.length > 1;

    for (const acc of agAccounts) {
      const accId = acc.id || 'primary';
      const labelPrefix = multi ? `[${acc.label || accId}] ` : '';
      for (const group of acc.groups || []) {
        const name = String(group?.name || '');
        if (!name || /argon/i.test(name)) continue;
        const weekly = (group.windows || []).find(
          (w) => w.window_type === 'WEEKLY' || /week/i.test(w.label || ''),
        );
        const resetIso = toIsoFromValue(weekly?.reset_time_iso ?? weekly?.reset_at);
        if (!resetIso) continue;
        const keySlug = name.toLowerCase().includes('gemini') ? 'gemini' : 'claude-gpt';
        const key = accId === 'primary' ? `ag:${keySlug}:weekly` : `ag:${accId}:${keySlug}:weekly`;
        entries.push({
          key,
          title: `Reset Mingguan: Antigravity ${labelPrefix}${name}`,
          description: `Kuota mingguan Antigravity ${labelPrefix}(${name}) reset.\nSisa terakhir: ${weekly.remaining_percent ?? '?'}%\nSumber: Quota Reset Automation Notifier`,
          resetIso,
        });
      }
    }
  }

  if (cfg.includeGeminiWebWeekly) {
    const gw = providers.gemini_web;
    const resetIso = toIsoFromValue(gw?.weekly_reset_at);
    if (resetIso) {
      const rem = typeof gw.weekly_used === 'number' ? Math.max(0, 100 - gw.weekly_used) : null;
      entries.push({
        key: 'gemini_web:weekly',
        title: 'Reset Mingguan: Gemini Web',
        description: `Kuota mingguan Gemini Web (${gw.plan_tier || 'AI Pro'}) reset.${rem !== null ? `\nSisa terakhir: ${rem}%` : ''}\nSumber: Quota Reset Automation Notifier`,
        resetIso,
      });
    }
  }

  if (cfg.includeCopilotMonthly) {
    const copilot = providers.github_copilot;
    const resetIso = !copilot?.error ? toIsoFromValue(copilot?.reset_time_iso ?? copilot?.reset_at) : null;
    if (resetIso) {
      entries.push({
        key: 'copilot:monthly',
        title: 'Reset Bulanan: GitHub Copilot',
        description: `AI Credits bulanan GitHub Copilot reset.\nSisa terakhir: ${copilot.percent_remaining ?? copilot.quota_percent ?? '?'}%\nSumber: Quota Reset Automation Notifier`,
        resetIso,
      });
    }
  }

  return entries;
}

export async function getCalendarAccessToken(env, fetchImpl = fetch) {
  if (!isGoogleCalendarConfigured(env)) {
    throw new Error('GCAL_CLIENT_ID, GCAL_CLIENT_SECRET, or GCAL_REFRESH_TOKEN is not configured');
  }

  const now = Date.now();
  if (env.QUOTA_KV) {
    const cached = await env.QUOTA_KV.get(KV_GCAL_TOKEN_KEY, 'json');
    if (
      cached &&
      typeof cached.accessToken === 'string' &&
      typeof cached.expiresAt === 'number' &&
      cached.expiresAt - TOKEN_REFRESH_BUFFER_MS > now
    ) {
      return cached.accessToken;
    }
  }

  const body = new URLSearchParams({
    client_id: env.GCAL_CLIENT_ID,
    client_secret: env.GCAL_CLIENT_SECRET,
    refresh_token: env.GCAL_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });

  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Google Calendar OAuth failed (${res.status}): ${data.error_description || data.error || 'unknown'}`);
  }

  const expiresInSec = Number(data.expires_in) || 3600;
  if (env.QUOTA_KV) {
    await env.QUOTA_KV.put(
      KV_GCAL_TOKEN_KEY,
      JSON.stringify({ accessToken: data.access_token, expiresAt: now + expiresInSec * 1000 }),
      { expirationTtl: Math.max(60, expiresInSec) },
    );
  }
  return data.access_token;
}

export function buildCalendarEventBody(entry, settings, offsetHours = 7) {
  const startMs = Date.parse(entry.resetIso);
  const endIso = new Date(startMs + 30 * 60 * 1000).toISOString();
  let start;
  let end;
  if (settings.allDay) {
    const dateStr = formatLocalDate(entry.resetIso, offsetHours);
    start = { date: dateStr };
    end = { date: nextDateString(dateStr) };
  } else {
    start = { dateTime: entry.resetIso };
    end = { dateTime: endIso };
  }

  return {
    summary: entry.title,
    description: entry.description,
    start,
    end,
    reminders:
      settings.reminderMinutes > 0
        ? { useDefault: false, overrides: [{ method: 'popup', minutes: settings.reminderMinutes }] }
        : { useDefault: false, overrides: [] },
  };
}

async function upsertCalendarEvent(accessToken, calendarId, existingEventId, body, fetchImpl) {
  const cal = encodeURIComponent(calendarId || 'primary');
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  if (existingEventId) {
    const patchRes = await fetchImpl(
      `${GCAL_API_BASE}/calendars/${cal}/events/${encodeURIComponent(existingEventId)}`,
      { method: 'PATCH', headers, body: JSON.stringify(body) },
    );
    if (patchRes.ok) {
      const updated = await patchRes.json();
      return updated.id || existingEventId;
    }
    // Fall through to POST if the old event was deleted (404/410)
    if (patchRes.status !== 404 && patchRes.status !== 410) {
      const errText = await patchRes.text();
      throw new Error(`Calendar PATCH failed (${patchRes.status}): ${errText.slice(0, 140)}`);
    }
  }

  const postRes = await fetchImpl(`${GCAL_API_BASE}/calendars/${cal}/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const created = await postRes.json().catch(() => ({}));
  if (!postRes.ok || !created.id) {
    throw new Error(`Calendar POST failed (${postRes.status}): ${created.error?.message || 'unknown'}`);
  }
  return created.id;
}

async function upsertGoogleTask(accessToken, taskListId, existingTaskId, entry, offsetHours, fetchImpl) {
  const list = encodeURIComponent(taskListId || '@default');
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  // Google Tasks `due` is RFC 3339 date-only (time portion is ignored by Google Tasks API)
  const dueDate = `${formatLocalDate(entry.resetIso, offsetHours)}T00:00:00.000Z`;
  const body = {
    title: entry.title,
    notes: `${entry.description}\nWaktu reset: ${entry.resetIso}`,
    due: dueDate,
    status: 'needsAction',
  };

  if (existingTaskId) {
    const patchRes = await fetchImpl(
      `${GTASKS_API_BASE}/lists/${list}/tasks/${encodeURIComponent(existingTaskId)}`,
      { method: 'PATCH', headers, body: JSON.stringify(body) },
    );
    if (patchRes.ok) {
      const updated = await patchRes.json();
      return updated.id || existingTaskId;
    }
    if (patchRes.status !== 404 && patchRes.status !== 410) {
      const errText = await patchRes.text();
      throw new Error(`Tasks PATCH failed (${patchRes.status}): ${errText.slice(0, 140)}`);
    }
  }

  const postRes = await fetchImpl(`${GTASKS_API_BASE}/lists/${list}/tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const created = await postRes.json().catch(() => ({}));
  if (!postRes.ok || !created.id) {
    throw new Error(`Tasks POST failed (${postRes.status}): ${created.error?.message || 'unknown'}`);
  }
  return created.id;
}

/**
 * Sync extracted weekly/monthly resets to Google Calendar and/or Google Tasks.
 * Skips entries whose reset timestamp & target flags haven't changed unless force=true.
 */
export async function syncWeeklyResetsToGoogle(env, snapshot, options = {}) {
  const configured = isGoogleCalendarConfigured(env);
  const settings = options.settings
    ? normalizeCalendarSettings(options.settings)
    : await loadCalendarSettings(env.QUOTA_KV);

  if (!configured) {
    return { ok: false, configured: false, enabled: settings.enabled, synced: [], skipped: [], errors: ['Google Calendar OAuth secrets not configured'] };
  }
  if (!settings.enabled && !options.force) {
    return { ok: true, configured: true, enabled: false, synced: [], skipped: [], errors: [] };
  }
  if (!settings.syncCalendar && !settings.syncTasks) {
    return { ok: true, configured: true, enabled: settings.enabled, synced: [], skipped: [], errors: [] };
  }

  const fetchImpl = options.fetchImpl || fetch;
  const offsetHours = Number(env.TIMEZONE_OFFSET_HOURS ?? 7);
  const entries = extractScheduledResets(snapshot, settings);
  if (entries.length === 0) {
    return { ok: true, configured: true, enabled: settings.enabled, synced: [], skipped: [], errors: [] };
  }

  const syncState = await loadCalendarSyncState(env.QUOTA_KV);
  let stateDirty = false;
  let accessToken = null;
  const synced = [];
  const skipped = [];
  const errors = [];

  const signature = `${settings.syncCalendar ? 'c' : ''}${settings.syncTasks ? 't' : ''}:${settings.allDay ? 'd' : 'h'}:${settings.reminderMinutes}:${settings.calendarId}:${settings.taskListId}`;

  for (const entry of entries) {
    const prev = syncState.items[entry.key] || {};
    const unchanged =
      !options.force &&
      prev.resetIso === entry.resetIso &&
      prev.signature === signature &&
      (!settings.syncCalendar || Boolean(prev.eventId)) &&
      (!settings.syncTasks || Boolean(prev.taskId));

    if (unchanged) {
      skipped.push(entry.key);
      continue;
    }

    try {
      if (!accessToken) {
        accessToken = await getCalendarAccessToken(env, fetchImpl);
      }
      const nextItem = {
        ...prev,
        resetIso: entry.resetIso,
        signature,
        lastSyncedAt: new Date().toISOString(),
      };

      if (settings.syncCalendar) {
        const eventBody = buildCalendarEventBody(entry, settings, offsetHours);
        nextItem.eventId = await upsertCalendarEvent(
          accessToken,
          settings.calendarId,
          prev.eventId,
          eventBody,
          fetchImpl,
        );
      }

      if (settings.syncTasks) {
        nextItem.taskId = await upsertGoogleTask(
          accessToken,
          settings.taskListId,
          prev.taskId,
          entry,
          offsetHours,
          fetchImpl,
        );
      }

      syncState.items[entry.key] = nextItem;
      syncState.lastSyncedAt = nextItem.lastSyncedAt;
      stateDirty = true;
      synced.push(entry.key);
    } catch (err) {
      errors.push(`${entry.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (stateDirty && env.QUOTA_KV) {
    await env.QUOTA_KV.put(KV_CAL_STATE_KEY, JSON.stringify(syncState));
  }

  return {
    ok: errors.length === 0,
    configured: true,
    enabled: settings.enabled,
    synced,
    skipped,
    errors,
  };
}
