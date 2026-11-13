/**
 * Antigravity Cloud Code API client (headless HTTPS).
 * Reverse-engineered from vscode-antigravity-cockpit (cloudcode_client.ts & trigger_service.ts).
 */

const CLOUDCODE_BASE_URLS = [
  'https://daily-cloudcode-pa.googleapis.com',
  'https://cloudcode-pa.googleapis.com',
];

const USER_AGENT = 'antigravity/hub/2.24.0 linux/x64';
const KV_PROJECT_KEY = 'cloudcode:project_info';
const PROJECT_CACHE_TTL_SEC = 24 * 60 * 60;

const ANTIGRAVITY_SYSTEM_PROMPT =
  'You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.**Absolute paths only****Proactiveness**';

const MODEL_BLACKLIST = new Set([
  'chat_20706',
  'chat_23310',
  'tab_flash_lite_preview',
  'tab_jump_flash_lite_preview',
]);

async function postCloudCode(path, body, accessToken) {
  let lastError;
  for (const baseUrl of CLOUDCODE_BASE_URLS) {
    const url = `${baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      throw new Error(`Cloud Code unauthorized (401) at ${path}`);
    }
    if (res.status >= 500 || res.status === 404) {
      lastError = new Error(`Cloud Code ${res.status} at ${url}`);
      continue;
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Cloud Code failed (${res.status}): ${errText.slice(0, 200)}`);
    }
    const text = await res.text();
    return { data: text ? JSON.parse(text) : {}, baseUrl };
  }
  throw lastError || new Error(`Cloud Code request failed at ${path}`);
}

/**
 * Resolve cloudaicompanionProject ID and tier metadata via loadCodeAssist.
 */
export async function resolveProjectInfo(accessToken, kv) {
  if (kv) {
    const cached = await kv.get(KV_PROJECT_KEY, 'json');
    if (cached && cached.projectId) {
      return cached;
    }
  }

  const { data } = await postCloudCode(
    '/v1internal:loadCodeAssist',
    {
      metadata: {
        ideName: 'antigravity',
        ideType: 'ANTIGRAVITY',
        updateChannel: 'stable',
        pluginType: 'GEMINI',
      },
      mode: 'FULL_ELIGIBILITY_CHECK',
    },
    accessToken,
  );

  const rawProject = data.cloudaicompanionProject;
  const projectId =
    typeof rawProject === 'string'
      ? rawProject
      : rawProject?.id || rawProject?.projectId || undefined;

  const tierId = data.paidTier?.id || data.currentTier?.id || 'free';
  const info = { projectId, tierId };

  if (kv && projectId) {
    await kv.put(KV_PROJECT_KEY, JSON.stringify(info), {
      expirationTtl: PROJECT_CACHE_TTL_SEC,
    });
  }
  return info;
}

const ARGON_WEEKLY_BUCKET_ID = 'gemini-argon-wtu-weekly';

function parseWindowFromBucket(bucket) {
  if (!bucket || typeof bucket !== 'object') return null;
  const rawFraction =
    bucket.remainingFraction ?? bucket.remaining_fraction ?? bucket.fraction;
  const fraction =
    typeof rawFraction === 'number' && Number.isFinite(rawFraction)
      ? Math.max(0, Math.min(1, rawFraction))
      : null;
  if (fraction === null) return null;

  const id = String(bucket.bucketId || bucket.quotaBucketId || bucket.id || bucket.key || '');
  const resetIso = bucket.resetTime || bucket.reset_time || null;
  const resetAt = resetIso ? Math.floor(Date.parse(resetIso) / 1000) : null;
  const rawType = String(
    bucket.quotaBucketType || bucket.windowType || bucket.type || bucket.label || id,
  ).toUpperCase();

  const isWeekly =
    rawType.includes('WEEK') ||
    rawType.includes('LONG') ||
    (resetAt !== null && resetAt - Math.floor(Date.now() / 1000) > 12 * 3600);

  return {
    id,
    label: isWeekly ? 'Weekly limit' : '5h limit',
    window_type: isWeekly ? 'WEEKLY' : '5H',
    remaining_fraction: fraction,
    remaining_percent: Math.round(fraction * 100),
    reset_at: Number.isFinite(resetAt) ? resetAt : null,
    reset_time_iso: resetIso,
  };
}

/**
 * Parse official quota_summary.groups into structured Quota Groups (5h + Weekly + Argon).
 */
export function parseQuotaGroups(modelsData, summaryData, parsedModels) {
  const rawSummaries = [
    modelsData?.quota_summary,
    modelsData?.quotaSummary,
    summaryData?.quota_summary,
    summaryData?.quotaSummary,
    Array.isArray(summaryData?.groups) ? summaryData : null,
  ].filter((s) => s && Array.isArray(s.groups));

  const groupMap = new Map();
  let argonWeekly = null;

  for (const summary of rawSummaries) {
    for (const [idx, rawGroup] of summary.groups.entries()) {
      if (!rawGroup || typeof rawGroup !== 'object') continue;
      const name =
        rawGroup.displayName || rawGroup.name || rawGroup.label || rawGroup.groupName || `Pool ${idx + 1}`;
      const rawBuckets =
        rawGroup.buckets ||
        rawGroup.quotaBuckets ||
        rawGroup.quotaWindows ||
        rawGroup.windows ||
        rawGroup.quotaLimits ||
        [];
      const bucketList = Array.isArray(rawBuckets) ? rawBuckets : Object.values(rawBuckets);
      const windows = [];

      for (const b of bucketList) {
        const w = parseWindowFromBucket(b);
        if (!w) continue;
        const normId = w.id.toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (normId === ARGON_WEEKLY_BUCKET_ID || normId.includes('argon-wtu-weekly')) {
          argonWeekly = { ...w, label: 'Weekly limit' };
          continue;
        }
        if (normId.includes('argon') && normId.includes('short')) continue;
        windows.push(w);
      }

      if (windows.length > 0 && !groupMap.has(name)) {
        windows.sort((a, b) => (a.window_type === 'WEEKLY' ? -1 : 1) - (b.window_type === 'WEEKLY' ? -1 : 1));
        groupMap.set(name, { name, windows });
      }
    }
  }

  const groups = Array.from(groupMap.values());
  if (argonWeekly) {
    groups.push({ name: 'Gemini 4 Argon', windows: [argonWeekly] });
  }

  // Fallback for any missing pool (e.g. Gemini Models if API only returned 3p summary)
  const hasGeminiGroup = groups.some((g) => g.name.toLowerCase().includes('gemini'));
  if (!hasGeminiGroup && parsedModels.length > 0) {
    const gemini = parsedModels.filter((m) => m.id.includes('gemini') && m.remaining_percent !== null);
    if (gemini.length > 0) {
      const minG = gemini.reduce((a, b) => (a.remaining_percent <= b.remaining_percent ? a : b));
      groups.unshift({
        name: 'Gemini Models',
        windows: [{
          id: 'gemini-5h',
          label: '5h limit',
          window_type: '5H',
          remaining_fraction: minG.remaining_fraction,
          remaining_percent: minG.remaining_percent,
          reset_at: minG.reset_at,
          reset_time_iso: minG.reset_time_iso,
        }],
      });
    }
  }

  const hasClaudeGroup = groups.some(
    (g) => g.name.toLowerCase().includes('claude') || g.name.toLowerCase().includes('gpt'),
  );
  if (!hasClaudeGroup && parsedModels.length > 0) {
    const claudeGpt = parsedModels.filter(
      (m) => (m.id.includes('claude') || m.id.includes('gpt')) && m.remaining_percent !== null,
    );
    if (claudeGpt.length > 0) {
      const minC = claudeGpt.reduce((a, b) => (a.remaining_percent <= b.remaining_percent ? a : b));
      const isWeekly = Boolean(minC.reset_at && minC.reset_at - Math.floor(Date.now() / 1000) > 12 * 3600);
      groups.push({
        name: 'Claude and GPT models',
        windows: [{
          id: 'claude-gpt-pool',
          label: isWeekly ? 'Weekly limit' : '5h limit',
          window_type: isWeekly ? 'WEEKLY' : '5H',
          remaining_fraction: minC.remaining_fraction,
          remaining_percent: minC.remaining_percent,
          reset_at: minC.reset_at,
          reset_time_iso: minC.reset_time_iso,
        }],
      });
    }
  }

  return groups;
}

/**
 * Normalize Cloud Code models & quota summary into a clean snapshot.
 */
export function parseAntigravityModels(data, summaryData) {
  const modelsMap = data?.models || {};
  const models = [];

  for (const [id, info] of Object.entries(modelsMap)) {
    if (!info || info.disabled || info.isInternal || MODEL_BLACKLIST.has(id)) {
      continue;
    }
    const quota = info.quotaInfo || {};
    const fraction =
      typeof quota.remainingFraction === 'number' && Number.isFinite(quota.remainingFraction)
        ? Math.max(0, Math.min(1, quota.remainingFraction))
        : null;

    models.push({
      id,
      name: info.displayName || id,
      model_constant: info.model || '',
      remaining_fraction: fraction,
      remaining_percent: fraction === null ? null : Math.round(fraction * 100),
      reset_at: quota.resetTime ? Math.floor(Date.parse(quota.resetTime) / 1000) : null,
      reset_time_iso: quota.resetTime || null,
    });
  }

  const groups = parseQuotaGroups(data, summaryData, models);
  const allGroupWindows = groups.flatMap((g) => g.windows);

  const withQuota = models.filter((m) => m.remaining_percent !== null);
  const quotaPercent =
    allGroupWindows.length > 0
      ? Math.min(...allGroupWindows.map((w) => w.remaining_percent))
      : withQuota.length > 0
        ? Math.min(...withQuota.map((m) => m.remaining_percent))
        : null;

  const fiveHourResets = allGroupWindows
    .filter((w) => w.window_type === '5H' && typeof w.reset_at === 'number')
    .map((w) => w.reset_at);
  const modelResets = withQuota
    .map((m) => m.reset_at)
    .filter((t) => typeof t === 'number' && Number.isFinite(t));

  const rollingResetAt =
    fiveHourResets.length > 0
      ? Math.min(...fiveHourResets)
      : modelResets.length > 0
        ? Math.min(...modelResets)
        : null;

  const weeklyResets = allGroupWindows
    .filter((w) => w.window_type === 'WEEKLY' && typeof w.reset_at === 'number')
    .map((w) => w.reset_at);
  const weeklyResetAt = weeklyResets.length > 0 ? Math.min(...weeklyResets) : null;

  return {
    quota_percent: quotaPercent,
    reset_at: rollingResetAt,
    rolling_reset_at: rollingResetAt,
    weekly_reset_at: weeklyResetAt,
    groups,
    models,
  };
}

/**
 * Fetch live Antigravity quota from Cloud Code APIs.
 */
export async function fetchAntigravityQuota(accessToken, projectInfo) {
  const payload = projectInfo?.projectId ? { project: projectInfo.projectId } : {};
  const [modelsRes, summaryRes] = await Promise.all([
    postCloudCode('/v1internal:fetchAvailableModels', payload, accessToken),
    postCloudCode('/v1internal:retrieveUserQuotaSummary', payload, accessToken).catch(() => ({
      data: null,
    })),
  ]);

  const parsed = parseAntigravityModels(modelsRes.data, summaryRes.data);
  return {
    ...parsed,
    plan_tier: projectInfo?.tierId || null,
    fetched_at: Math.floor(Date.now() / 1000),
    source: 'cloudcode',
    estimated: false,
  };
}

/**
 * Send a minimal prompt ("hi") via streamGenerateContent?alt=sse to start the quota rolling timer.
 */
export async function triggerAutoWake(accessToken, projectId, options = {}) {
  const model = options.model || 'gemini-3-flash';
  const prompt = options.prompt || '1+1';
  const maxOutputTokens = Number(options.maxOutputTokens) || 16;

  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const body = {
    project: projectId || `projects/random-${rand}/locations/global`,
    requestId: `req_${ts}_${rand}`,
    model,
    userAgent: 'antigravity',
    requestType: 'agent',
    request: {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      session_id: `sess_${ts}_${rand}`,
      systemInstruction: { parts: [{ text: ANTIGRAVITY_SYSTEM_PROMPT }] },
      generationConfig: {
        ...(maxOutputTokens > 0 ? { maxOutputTokens } : {}),
        temperature: 0,
      },
    },
  };

  const url = `${CLOUDCODE_BASE_URLS[0]}/v1internal:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Auto-Wake stream failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const sseText = await res.text();
  return parseSseResponse(sseText, model);
}

export function parseSseResponse(sseText, model) {
  const replyParts = [];
  let totalTokens;
  let traceId;

  for (const rawLine of sseText.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const jsonStr = line.slice(5).trim();
    if (!jsonStr || jsonStr === '[DONE]') continue;

    try {
      const obj = JSON.parse(jsonStr);
      const response = obj.response || obj;
      const parts = response?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part && part.thought !== true && typeof part.text === 'string') {
            replyParts.push(part.text);
          }
        }
      }
      const usage = response?.usageMetadata || obj.usageMetadata;
      if (usage?.totalTokenCount !== undefined) {
        totalTokens = usage.totalTokenCount;
      }
      traceId ??= obj.traceId;
    } catch {
      // ignore malformed SSE chunk
    }
  }

  return {
    model,
    reply: replyParts.join('').trim() || '(ok)',
    totalTokens: totalTokens ?? null,
    traceId: traceId ?? null,
    triggeredAt: new Date().toISOString(),
  };
}
