import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldTriggerOnReset,
  isWithinTimeWindow,
  RESET_SAFETY_MARGIN_MS,
  RESET_TRIGGER_COOLDOWN_MS,
  IDLE_CYCLE_COOLDOWN_MS,
} from '../src/wake_engine.js';
import {
  parseAntigravityModels,
  parseSseResponse,
  normalizeLowModelId,
  buildWakeBody,
  triggerAutoWake,
} from '../src/cloudcode.js';
import { pickPoolModel, getPoolCandidateModels } from '../src/index.js';
import { renderDashboardHtml } from '../src/dashboard.js';
import { parseCopilotUserResponse } from '../src/copilot.js';
import { sendDedupedAlert } from '../src/notifier.js';
import {
  decodeBatchExecuteEnvelope,
  parseGeminiRpcWindows,
  parseGeminiGraphqlUsage,
  computeBurnRateForecast,
} from '../src/gemini_rpc.js';

test('shouldTriggerOnReset enforces all 4 guards', () => {
  const now = Date.parse('2026-11-13T05:00:00Z');
  const prevReset = '2026-11-13T04:55:00Z';
  const nextReset = '2026-11-13T09:55:00Z';

  // 1. Not full
  assert.equal(
    shouldTriggerOnReset({ remaining_fraction: 0.8, reset_time_iso: nextReset }, {}, now).reason,
    'not_full',
  );

  // 2. Inside 2-minute safety margin after previous resetAt
  assert.equal(
    shouldTriggerOnReset(
      { remaining_fraction: 1.0, reset_time_iso: nextReset },
      { lastTriggeredResetAt: new Date(now - RESET_SAFETY_MARGIN_MS + 10_000).toISOString() },
      now,
    ).reason,
    'safety_margin',
  );

  // 3. Same resetAt cycle
  assert.equal(
    shouldTriggerOnReset(
      { remaining_fraction: 1.0, reset_time_iso: prevReset },
      { lastTriggeredResetAt: prevReset, lastTriggerAt: now - RESET_TRIGGER_COOLDOWN_MS - 1000 },
      now,
    ).reason,
    'already_triggered_for_cycle',
  );

  // 4. Cooldown active
  assert.equal(
    shouldTriggerOnReset(
      { remaining_fraction: 1.0, reset_time_iso: nextReset },
      { lastTriggeredResetAt: prevReset, lastTriggerAt: now - RESET_TRIGGER_COOLDOWN_MS + 10_000 },
      now,
    ).reason,
    'cooldown_active',
  );

  // 5. All guards passed
  assert.deepEqual(
    shouldTriggerOnReset(
      { remaining_fraction: 1.0, reset_time_iso: nextReset },
      { lastTriggeredResetAt: prevReset, lastTriggerAt: now - RESET_TRIGGER_COOLDOWN_MS - 1000 },
      now,
    ),
    { shouldTrigger: true, reason: 'all_guards_passed' },
  );

  // 6. Future reset_time_iso (active 5h window just woken) stays blocked until reset passes
  assert.equal(
    shouldTriggerOnReset(
      { remaining_fraction: 1.0, reset_time_iso: '2026-11-13T10:01:00Z' },
      { lastTriggeredResetAt: nextReset, lastTriggerAt: now - RESET_TRIGGER_COOLDOWN_MS - 1000 },
      now,
    ).reason,
    'safety_margin',
  );
});

test('isWithinTimeWindow handles standard and overnight windows', () => {
  // 10:00 UTC = 17:00 UTC+7
  const utc10 = Date.parse('2026-11-13T10:00:00Z');
  assert.equal(isWithinTimeWindow('08:00-22:00', 7, utc10), true);
  assert.equal(isWithinTimeWindow('18:00-23:00', 7, utc10), false);
  assert.equal(isWithinTimeWindow('22:00-06:00', 7, utc10), false);
  assert.equal(isWithinTimeWindow('', 7, utc10), true);
});

test('parseAntigravityModels filters internal/blacklisted models and extracts weekly reset', () => {
  const raw = {
    models: {
      'gemini-3-flash': {
        displayName: 'Gemini 3 Flash',
        model: 'MODEL_GEMINI_3_FLASH',
        quotaInfo: { remainingFraction: 0.75, resetTime: '2026-11-13T10:00:00Z' },
      },
      chat_20706: {
        displayName: 'Internal',
        quotaInfo: { remainingFraction: 1, resetTime: '2026-11-13T10:00:00Z' },
      },
      hidden_model: {
        displayName: 'Hidden',
        isInternal: true,
        quotaInfo: { remainingFraction: 1 },
      },
    },
  };
  const summary = {
    quota_summary: {
      groups: [{
        displayName: 'Gemini Models',
        buckets: [{ windowType: 'WEEKLY', remainingFraction: 0.28, resetTime: '2026-11-20T00:00:00Z' }],
      }],
    },
  };

  const parsed = parseAntigravityModels(raw, summary);
  assert.equal(parsed.models.length, 1);
  assert.equal(parsed.models[0].id, 'gemini-3-flash');
  assert.equal(parsed.quota_percent, 28);
  assert.equal(parsed.weekly_reset_at, Math.floor(Date.parse('2026-11-20T00:00:00Z') / 1000));
  assert.equal(parsed.groups.length, 1);
  assert.equal(parsed.groups[0].windows[0].label, 'Weekly limit');
});

test('parseSseResponse extracts reply text and token breakdown', () => {
  const sse = [
    'data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"thinking"},{"text":"Hi!"}]}}],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":2,"thoughtsTokenCount":0,"totalTokenCount":10}},"traceId":"tr_1"}',
    'data: [DONE]',
  ].join('\n');

  const res = parseSseResponse(sse, 'gemini-3-flash');
  assert.equal(res.reply, 'Hi!');
  assert.equal(res.promptTokens, 8);
  assert.equal(res.outputTokens, 2);
  assert.equal(res.thoughtsTokens, 0);
  assert.equal(res.totalTokens, 10);
  assert.equal(res.traceId, 'tr_1');
});

test('sendDedupedAlert skips duplicate cycle tokens', async () => {
  const dedup = { 'low:ag:gemini-3-flash': '2026-11-13T10:00:00Z' };
  const sent = await sendDedupedAlert(
    {},
    dedup,
    'low:ag:gemini-3-flash',
    '2026-11-13T10:00:00Z',
    'test',
  );
  assert.equal(sent, false);
});

test('parseCopilotUserResponse extracts AI credits and monthly reset', () => {
  const parsed = parseCopilotUserResponse({
    access_type_sku: 'free_educational_quota',
    token_based_billing: true,
    quota_reset_date_utc: '2026-12-01T00:00:00.000Z',
    quota_snapshots: {
      chat: { percent_remaining: 100, unlimited: true },
      premium_interactions: {
        percent_remaining: 37.1,
        credits_used: 125,
        quota_remaining: 74.3,
        entitlement: 200,
        unlimited: false,
      },
    },
  });

  assert.equal(parsed.plan_tier, 'free_educational_quota');
  assert.equal(parsed.quota_percent, 37);
  assert.equal(parsed.percent_remaining, 37.1);
  assert.equal(parsed.percent_used, 62.9);
  assert.equal(parsed.credits_used, 125);
  assert.equal(parsed.credits_remaining, 74.3);
  assert.equal(parsed.credits_entitlement, 200);
});

test('decodeBatchExecuteEnvelope and parseGeminiRpcWindows extract exact timestamps and tier', () => {
  const innerPayload = JSON.stringify([
    2,
    [
      [2160, 0.1, 1, [[1794650000, 0]]],
      [44513, 0.08, 2, [[1795000000, 0]]],
    ],
    false,
  ]);
  const envelope = [
    ")]}'",
    '',
    '120',
    JSON.stringify([['wrb.fr', 'jSf9Qc', innerPayload, null, null, null, 'generic']]),
  ].join('\n');

  const decoded = decodeBatchExecuteEnvelope(envelope, 'jSf9Qc');
  const parsed = parseGeminiRpcWindows(decoded, [['plus_policy']]);

  assert.equal(parsed.planTier, 'AI Pro');
  assert.equal(parsed.dailyUsed, 10);
  assert.equal(parsed.dailyResetAt, new Date(1794650000 * 1000).toISOString());
  assert.equal(parsed.remaining5h, 2160);
  assert.equal(parsed.weeklyUsed, 8);
  assert.equal(parsed.weeklyResetAt, new Date(1795000000 * 1000).toISOString());
  assert.equal(parsed.remaining7d, 44513);
});

test('computeBurnRateForecast detects on_track vs over_pace depletion', () => {
  const nowMs = Date.parse('2026-11-14T10:00:00Z');
  // 4 hours remaining out of 5h window (20% elapsed)
  const resetAtMs = nowMs + 4 * 3600 * 1000;

  const safe = computeBurnRateForecast(10, resetAtMs, 5, nowMs);
  assert.equal(safe.status, 'on_track');
  assert.equal(safe.willExhaustBeforeReset, false);

  const fast = computeBurnRateForecast(50, resetAtMs, 5, nowMs);
  assert.equal(fast.status, 'over_pace');
  assert.equal(fast.willExhaustBeforeReset, true);
  assert.equal(fast.depletionMs, 3600 * 1000);
});

test('normalizeLowModelId and pickPoolModel always select lightest low/flash models over -medium/-high', () => {
  assert.equal(normalizeLowModelId('claude-sonnet-5-5-medium'), 'claude-sonnet-5-5-low');
  assert.equal(normalizeLowModelId('gemini-3.8-flash-high'), 'gemini-3.8-flash-low');
  assert.equal(normalizeLowModelId('gemini-4-argon-medium'), 'gemini-4-argon-low');

  const snapshot = {
    models: [
      { id: 'gemini-3.1-pro-high', name: 'Gemini 3.1 Pro (High)' },
      { id: 'gemini-3.1-pro-low', name: 'Gemini 3.1 Pro (Low)' },
      { id: 'gemini-3-flash', name: 'Gemini 3 Flash' },
      { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite' },
      { id: 'claude-sonnet-4-6-medium', name: 'Claude Sonnet 4.6 (Medium)' },
      { id: 'claude-sonnet-4-6-low', name: 'Claude Sonnet 4.6 (Low)' },
      { id: 'gemini-4-argon-medium', name: 'Gemini 4 Argon (Medium)' },
      { id: 'gemini-4-argon-low', name: 'Gemini 4 Argon (Low)' },
    ],
  };

  assert.equal(
    pickPoolModel(snapshot, 'Gemini Models', 'gemini-3.1-pro-high'),
    'gemini-3-flash',
  );
  assert.deepEqual(
    getPoolCandidateModels(snapshot, 'Gemini Models', 'gemini-3.1-pro-high'),
    ['gemini-3-flash', 'gemini-3.1-pro-low', 'gemini-3.5-flash-lite'],
  );
  assert.equal(
    pickPoolModel(snapshot, 'Claude and GPT models', 'claude-sonnet-5-5-medium'),
    'claude-sonnet-4-6-low',
  );
  assert.equal(
    pickPoolModel(snapshot, 'Gemini 4 Argon', 'gemini-4-argon-medium'),
    'gemini-4-argon-low',
  );
});

test('renderDashboardHtml renders wake decisions, token breakdown, and burn-rate forecast', () => {
  const html = renderDashboardHtml(
    {
      fetched_at: Math.floor(Date.now() / 1000),
      providers: {
        antigravity: {
          plan_tier: 'pro',
          wake_decisions: { gemini: { modelId: 'gemini-3-flash', shouldTrigger: false, reason: 'cooldown_active' } },
          groups: [
            {
              name: 'Gemini Models',
              windows: [{ label: '5h limit', remaining_percent: 100, reset_at: null }],
            },
          ],
          models: [],
        },
        gemini_web: {
          plan_tier: 'AI Pro',
          daily_used: 15,
          daily_reset_label: '14:00',
          daily_reset_at: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
          weekly_used: 10,
          weekly_reset_label: '20 Nov',
          weekly_reset_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
        },
      },
    },
    {
      lastWakeResult: {
        model: 'gemini-3-flash',
        reply: '(ok)',
        promptTokens: 8,
        outputTokens: 4,
        totalTokens: 12,
        thoughtsTokens: 0,
        triggeredAt: new Date().toISOString(),
      },
    },
    7,
  );

  assert.match(html, /cooldown_active/);
  assert.match(html, /12 tok \(in:8 · think:0 · out:4\)/);
  assert.match(html, /Laju aman/);
  assert.match(html, /data-i18n="paceSafe"/);
});

test('parseGeminiGraphqlUsage extracts GXU_FIVE_HOURLY and GXU_WEEKLY pools', () => {
  const parsed = parseGeminiGraphqlUsage({
    data: {
      viewer: {
        rpcs: {
          getUsageInfo: {
            subscriptionTier: 'AI Pro',
            pools: [
              {
                poolType: 'GXU_FIVE_HOURLY',
                percentageUsed: 0.19,
                gxu: { windowRefreshesAt: '2026-11-16T16:29:00Z' },
              },
              {
                poolType: 'GXU_WEEKLY',
                percentageUsed: 0.26,
                gxu: { windowRefreshesAt: '2026-11-17T06:29:00Z' },
              },
            ],
          },
        },
      },
    },
  });

  assert.equal(parsed.planTier, 'AI Pro');
  assert.equal(parsed.dailyUsed, 19);
  assert.equal(parsed.dailyResetAt, '2026-11-16T16:29:00.000Z');
  assert.equal(parsed.weeklyUsed, 26);
  assert.equal(parsed.weeklyResetAt, '2026-11-17T06:29:00.000Z');
});

test('shouldTriggerOnReset wakes 100% idle pool without resetTime and blocks for 5h cycle', () => {
  const now = Date.parse('2026-11-17T04:00:00Z');
  assert.deepEqual(
    shouldTriggerOnReset({ remaining_fraction: 1.0, reset_time_iso: null }, {}, now),
    { shouldTrigger: true, reason: 'all_guards_passed' },
  );

  assert.equal(
    shouldTriggerOnReset(
      { remaining_fraction: 1.0, reset_time_iso: null },
      { lastTriggeredResetAt: null, lastTriggerAt: now - 30 * 60 * 1000 },
      now,
    ).reason,
    'already_triggered_for_cycle',
  );

  assert.deepEqual(
    shouldTriggerOnReset(
      { remaining_fraction: 1.0, reset_time_iso: null },
      { lastTriggeredResetAt: null, lastTriggerAt: now - IDLE_CYCLE_COOLDOWN_MS },
      now,
    ),
    { shouldTrigger: true, reason: 'all_guards_passed' },
  );
});

test('getPoolCandidateModels handles Medium-only Gemini 3.8/4 catalogs without dropping live models', () => {
  const snapshot = {
    models: [
      { id: 'gemini-4-argon-medium', name: 'Gemini 4 Argon Medium' },
      { id: 'gemini-4-hydrogen-medium', name: 'Gemini 4 Hydrogen Medium' },
      { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash Medium' },
    ],
  };

  assert.deepEqual(
    getPoolCandidateModels(snapshot, 'Gemini Models', 'gemini-3.8-flash-low'),
    [
      'gemini-3.8-flash-low',
      'gemini-4-hydrogen-low',
      'gemini-3.8-flash-medium',
      'gemini-4-hydrogen-medium',
      'gemini-3.8-flash',
      'gemini-3-flash',
    ],
  );
});

test('parseAntigravityModels supports nested quotaInfo buckets and synthesizes missing Gemini 5H window', () => {
  const future5h = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
  const futureWeekly = new Date(Date.now() + 96 * 3600 * 1000).toISOString();
  const raw = {
    models: {
      'gemini-3.8-flash-medium': {
        displayName: 'Gemini 3.8 Flash Medium',
        quotaInfo: { remainingFraction: 1.0 },
      },
      'gemini-4-argon-medium': {
        displayName: 'Gemini 4 Argon Medium',
        quotaInfo: { remainingFraction: 0.81, resetTime: futureWeekly },
      },
    },
  };
  const summary = {
    quota_summary: {
      groups: [
        {
          displayName: 'Gemini Models',
          buckets: [{ quotaBucketType: 'LONG_TERM', quotaInfo: { remainingFraction: 0.88, resetTime: futureWeekly } }],
        },
        {
          displayName: 'Claude and GPT models',
          buckets: [
            { quotaBucketType: 'LONG_TERM', quotaInfo: { resetTime: futureWeekly } },
            { quotaBucketType: 'SHORT_TERM', quotaInfo: { remainingFraction: 1.0, resetTime: future5h } },
          ],
        },
      ],
    },
  };

  const parsed = parseAntigravityModels(raw, summary);
  const geminiGroup = parsed.groups.find((g) => g.name === 'Gemini Models');
  const claudeGroup = parsed.groups.find((g) => g.name === 'Claude and GPT models');

  assert.equal(geminiGroup.windows.length, 2);
  assert.equal(geminiGroup.windows[0].window_type, 'WEEKLY');
  assert.equal(geminiGroup.windows[1].window_type, '5H');
  assert.equal(geminiGroup.windows[1].remaining_percent, 100);
  assert.equal(geminiGroup.windows[1].reset_time_iso, null);
  assert.equal(claudeGroup.windows[0].remaining_percent, 0);
  assert.equal(claudeGroup.windows[1].window_type, '5H');
});

test('buildWakeBody and triggerAutoWake minimize input and output tokens with 1+1= and maxOutputTokens=1', async () => {
  const defaultBody = buildWakeBody('proj_1', 'gemini-3.8-flash-low', '1+1=', 1, true);
  assert.equal(defaultBody.request.systemInstruction, undefined);
  assert.equal(defaultBody.request.contents[0].parts[0].text, '1+1=');
  assert.equal(defaultBody.request.generationConfig.maxOutputTokens, 1);
  assert.deepEqual(defaultBody.request.generationConfig.stopSequences, ['\n']);
  assert.deepEqual(defaultBody.request.generationConfig.thinkingConfig, { thinkingBudget: 0 });

  const originalFetch = globalThis.fetch;
  const sentBodies = [];
  globalThis.fetch = async (_url, init) => {
    const parsed = JSON.parse(init.body);
    sentBodies.push(parsed);
    if (sentBodies.length === 1) {
      return new Response('missing systemInstruction', { status: 400 });
    }
    return new Response(
      'data: {"response":{"candidates":[{"content":{"parts":[{"text":"2"}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":1,"thoughtsTokenCount":0,"totalTokenCount":6}}}\n',
      { status: 200 },
    );
  };

  try {
    const res = await triggerAutoWake('tok_1', 'proj_1', { model: 'gemini-3.8-flash-low' });
    assert.equal(sentBodies.length, 2);
    assert.equal(sentBodies[0].request.systemInstruction, undefined);
    assert.equal(sentBodies[0].request.contents[0].parts[0].text, '1+1=');
    assert.equal(sentBodies[0].request.generationConfig.maxOutputTokens, 1);
    assert.deepEqual(sentBodies[1].request.systemInstruction, { parts: [{ text: '.' }] });
    assert.equal(res.reply, '2');
    assert.equal(res.outputTokens, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('shouldTriggerOnReset wakes idle WEEKLY-only pool (Gemini 4 Argon) and skips active weekly timer', () => {
  const now = Date.parse('2026-11-17T10:00:00Z');
  const activeWeeklyReset = new Date(now + 6 * 24 * 3600 * 1000).toISOString();

  // Idle 100% weekly pool (no resetTime yet) -> wakes
  assert.deepEqual(
    shouldTriggerOnReset(
      { window_type: 'WEEKLY', remaining_fraction: 1.0, reset_time_iso: null },
      {},
      now,
    ),
    { shouldTrigger: true, reason: 'all_guards_passed' },
  );

  // Active weekly pool (resetTime already 6d in future) -> skipped
  assert.equal(
    shouldTriggerOnReset(
      { window_type: 'WEEKLY', remaining_fraction: 1.0, reset_time_iso: activeWeeklyReset },
      {},
      now,
    ).reason,
    'already_triggered_for_cycle',
  );
});

test('parseAntigravityModels synthesizes Gemini 4 Argon weekly group when omitted from quota_summary', () => {
  const parsed = parseAntigravityModels(
    {
      models: {
        'gemini-4-argon-medium': {
          displayName: 'Gemini 4 Argon (Medium)',
          quotaInfo: { remainingFraction: 1.0 },
        },
      },
    },
    null,
  );
  const argonGroup = parsed.groups.find((g) => g.name === 'Gemini 4 Argon');
  assert.ok(argonGroup);
  assert.equal(argonGroup.windows[0].window_type, 'WEEKLY');
  assert.equal(argonGroup.windows[0].remaining_percent, 100);
});
