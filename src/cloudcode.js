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

export class CloudCodeLimitError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'CloudCodeLimitError';
    this.status = status;
    this.code = code;
  }
}

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
    if (res.status >= 500) {
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
export async function resolveProjectInfo(accessToken, kv, accountId = 'primary') {
  const cacheKey = accountId === 'primary' ? KV_PROJECT_KEY : `${KV_PROJECT_KEY}:${accountId}`;
  if (kv) {
    const cached = await kv.get(cacheKey, 'json');
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
    await kv.put(cacheKey, JSON.stringify(info), {
      expirationTtl: PROJECT_CACHE_TTL_SEC,
    });
  }
  return info;
}

const ARGON_WEEKLY_BUCKET_ID = 'gemini-argon-wtu-weekly';

function isArgonEntry(m) {
  return /(?:gemini[-\s]+(?:4[-\s]+)?argon|model_placeholder_m41[789])/i.test(`${m.id || ''} ${m.name || ''}`);
}

function resolveBucketMetricRecord(bucket) {
  const candidates = [
    bucket,
    bucket.quotaInfo,
    bucket.quota_info,
    bucket.quota,
    bucket.limit,
    bucket.window,
    bucket.bucket,
  ];
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    const hasFraction =
      c.remainingFraction !== undefined ||
      c.remaining_fraction !== undefined ||
      c.fraction !== undefined ||
      c.remaining !== undefined;
    const hasReset =
      c.resetTime !== undefined ||
      c.reset_time !== undefined ||
      c.resetTimestamp !== undefined ||
      c.reset_timestamp !== undefined;
    if (hasFraction || hasReset) return c;
  }
  return bucket;
}

function parseWindowFromBucket(bucket) {
  if (!bucket || typeof bucket !== 'object') return null;
  const id = String(bucket.bucketId || bucket.quotaBucketId || bucket.id || bucket.key || '');
  const normId = id.toLowerCase().replace(/[^a-z0-9-]/g, '');
  const metric = resolveBucketMetricRecord(bucket);

  const resetIso =
    metric.resetTime ||
    metric.reset_time ||
    metric.resetTimestamp ||
    metric.reset_timestamp ||
    bucket.resetTime ||
    bucket.reset_time ||
    null;

  const rawFraction =
    metric.remainingFraction ?? metric.remaining_fraction ?? metric.fraction ?? metric.remaining;
  let fraction =
    typeof rawFraction === 'number' && Number.isFinite(rawFraction)
      ? Math.max(0, Math.min(1, rawFraction))
      : null;

  // Proto3 JSON omits zero-valued remainingFraction when resetTime is set; Argon buckets require explicit fraction.
  if (fraction === null && resetIso && !normId.includes('argon')) {
    fraction = 0;
  }
  if (fraction === null) return null;

  const resetAt = resetIso ? Math.floor(Date.parse(resetIso) / 1000) : null;
  const rawType = String(
    bucket.quotaBucketType ??
      metric.quotaBucketType ??
      bucket.windowType ??
      bucket.type ??
      bucket.label ??
      id,
  ).toUpperCase();

  const isWeekly =
    rawType === '1' ||
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
 * Parse official quota_summary.groups into structured Quota Groups (5h + Weekly).
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

  // Gemini 4 Argon was removed from Antigravity; ignore any leftover Argon group.
  const groups = Array.from(groupMap.values()).filter((g) => !/argon/i.test(g.name));

  // Fallback for missing Gemini group or Gemini group returning only WEEKLY without 5H
  const geminiGroup = groups.find(
    (g) => g.name.toLowerCase().includes('gemini') && !g.name.toLowerCase().includes('argon'),
  );
  const needsGemini5h = !geminiGroup || !geminiGroup.windows.some((w) => w.window_type === '5H');
  if (needsGemini5h && parsedModels.length > 0) {
    const nowSec = Math.floor(Date.now() / 1000);
    const gemini = parsedModels.filter(
      (m) =>
        m.id.includes('gemini') &&
        !isArgonEntry(m) &&
        m.remaining_percent !== null &&
        (m.reset_at === null || m.reset_at - nowSec <= 12 * 3600),
    );
    if (gemini.length > 0) {
      const minG = gemini.reduce((a, b) => (a.remaining_percent <= b.remaining_percent ? a : b));
      const win5h = {
        id: 'gemini-5h',
        label: '5h limit',
        window_type: '5H',
        remaining_fraction: minG.remaining_fraction,
        remaining_percent: minG.remaining_percent,
        reset_at: minG.reset_at,
        reset_time_iso: minG.reset_time_iso,
      };
      if (!geminiGroup) {
        groups.unshift({ name: 'Gemini Models', windows: [win5h] });
      } else {
        geminiGroup.windows.push(win5h);
      }
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
 * Normalize any -medium or -high model suffix to -low so Auto-Wake always uses the lowest tier.
 */
export function normalizeLowModelId(modelId) {
  if (!modelId || typeof modelId !== 'string') return '';
  return modelId.trim().replace(/-(?:medium|high)$/i, '-low');
}

export function buildWakeBody(
  projectId,
  model,
  prompt,
  maxOutputTokens,
  includeThinkingZero,
  systemPrompt = '',
) {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const isClaude = String(model || '').toLowerCase().includes('claude');
  const request = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    session_id: `sess_${ts}_${rand}`,
    generationConfig: {
      ...(maxOutputTokens > 0 ? { maxOutputTokens } : {}),
      temperature: 0,
      ...(!isClaude ? { stopSequences: ['\n'] } : {}),
      ...(includeThinkingZero ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  };
  if (systemPrompt) {
    request.systemInstruction = { parts: [{ text: systemPrompt }] };
  }
  return {
    project: projectId || `projects/random-${rand}/locations/global`,
    requestId: `req_${ts}_${rand}`,
    model,
    userAgent: 'antigravity',
    requestType: 'agent',
    request,
  };
}

function classifyLimitError(status, errText) {
  const upper = (errText || '').toUpperCase();
  if (status === 429 || upper.includes('RESOURCE_EXHAUSTED')) {
    return new CloudCodeLimitError(
      `Auto-Wake rate limited (${status}): ${errText.slice(0, 200)}`,
      status,
      'rate_limited',
    );
  }
  if (
    status === 403 &&
    (upper.includes('VALIDATION_REQUIRED') ||
      upper.includes('TOS_VIOLATION') ||
      upper.includes('PERMISSION_DENIED'))
  ) {
    const code = upper.includes('VALIDATION_REQUIRED') ? 'validation_required' : 'forbidden';
    return new CloudCodeLimitError(
      `Auto-Wake blocked (${status} ${code}): ${errText.slice(0, 200)}`,
      status,
      code,
    );
  }
  return null;
}

/**
 * Send a minimal prompt ("1+1=") via streamGenerateContent?alt=sse to start the quota rolling timer.
 */
export async function triggerAutoWake(accessToken, projectId, options = {}) {
  const model = options.allowExactModel
    ? (options.model || '').trim() || 'gemini-3.8-flash-low'
    : normalizeLowModelId(options.model) || 'gemini-3.8-flash-low';
  const prompt = options.prompt || '1+1=';
  const maxOutputTokens = Math.max(1, Number(options.maxOutputTokens) || 1);
  const disableThinking = options.disableThinking !== false;
  let systemPrompt = typeof options.systemPrompt === 'string' ? options.systemPrompt.trim() : '';

  const tryModes = disableThinking ? [true, false] : [false];
  let lastError;

  for (let i = 0; i < tryModes.length; i++) {
    const useThinkingZero = tryModes[i];
    const body = buildWakeBody(projectId, model, prompt, maxOutputTokens, useThinkingZero, systemPrompt);

    for (const baseUrl of CLOUDCODE_BASE_URLS) {
      const url = `${baseUrl}/v1internal:streamGenerateContent?alt=sse`;
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        lastError = err;
        continue;
      }

      if (res.ok) {
        const sseText = await res.text();
        return parseSseResponse(sseText, model);
      }

      const errText = await res.text();
      const limitErr = classifyLimitError(res.status, errText);
      if (limitErr) throw limitErr;

      if (res.status >= 500) {
        lastError = new Error(`Auto-Wake stream failed (${res.status}) at ${baseUrl}`);
        continue;
      }

      if (res.status === 400 && !systemPrompt && /system/i.test(errText)) {
        // Fallback if Cloud Code enforces a non-empty systemInstruction on agent requests.
        systemPrompt = '.';
        i--;
        lastError = new Error(`Auto-Wake required systemInstruction (${res.status})`);
        break;
      }

      if (
        res.status === 400 &&
        useThinkingZero &&
        /thinking/i.test(errText)
      ) {
        lastError = new Error(`Auto-Wake rejected thinkingBudget=0 (${res.status})`);
        break;
      }

      throw new Error(`Auto-Wake stream failed (${res.status}): ${errText.slice(0, 200)}`);
    }
  }

  throw lastError || new Error('Auto-Wake stream failed on all endpoints');
}

export function parseSseResponse(sseText, model) {
  const replyParts = [];
  let promptTokens = null;
  let outputTokens = null;
  let thoughtsTokens = null;
  let totalTokens = null;
  let traceId = null;

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
      if (usage) {
        if (usage.promptTokenCount !== undefined) promptTokens = usage.promptTokenCount;
        if (usage.candidatesTokenCount !== undefined) outputTokens = usage.candidatesTokenCount;
        if (usage.thoughtsTokenCount !== undefined) thoughtsTokens = usage.thoughtsTokenCount;
        if (usage.totalTokenCount !== undefined) totalTokens = usage.totalTokenCount;
      }
      traceId ??= obj.traceId ?? null;
    } catch {
      // ignore malformed SSE chunk
    }
  }

  return {
    model,
    reply: replyParts.join('').trim() || '(ok)',
    promptTokens,
    outputTokens,
    thoughtsTokens,
    totalTokens,
    traceId,
    triggeredAt: new Date().toISOString(),
  };
}
