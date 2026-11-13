import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldTriggerOnReset,
  isWithinTimeWindow,
  RESET_SAFETY_MARGIN_MS,
  RESET_TRIGGER_COOLDOWN_MS,
} from '../src/wake_engine.js';
import { parseAntigravityModels, parseSseResponse } from '../src/cloudcode.js';
import { parseCopilotUserResponse } from '../src/copilot.js';
import { sendDedupedAlert } from '../src/notifier.js';

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

test('parseSseResponse extracts reply text and token usage', () => {
  const sse = [
    'data: {"response":{"candidates":[{"content":{"parts":[{"thought":true,"text":"thinking"},{"text":"Hi!"}]}}],"usageMetadata":{"totalTokenCount":42}},"traceId":"tr_1"}',
    'data: [DONE]',
  ].join('\n');

  const res = parseSseResponse(sse, 'gemini-3-flash');
  assert.equal(res.reply, 'Hi!');
  assert.equal(res.totalTokens, 42);
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
