/**
 * Persistent-dedup notification dispatcher for Telegram & Discord.
 */

const DEDUP_KV_KEY = 'notify:dedup_state';
const DEDUP_TTL_SEC = 7 * 24 * 60 * 60;

async function postJsonWithRetry(url, payload, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) return true;
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
        continue;
      }
      const text = await res.text();
      throw new Error(`Notification failed (${res.status}): ${text.slice(0, 150)}`);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
  }
  throw lastErr;
}

export async function sendAlert(env, text) {
  const deliveries = [];

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    const tgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    deliveries.push(
      postJsonWithRetry(tgUrl, {
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    );
  }

  if (env.DISCORD_WEBHOOK_URL) {
    // Strip simple HTML tags for Discord plain/markdown readability
    const plain = text.replace(/<\/?b>/g, '**').replace(/<\/?code>/g, '`');
    deliveries.push(
      postJsonWithRetry(env.DISCORD_WEBHOOK_URL, {
        content: plain,
      }),
    );
  }

  if (deliveries.length === 0) return { sent: 0 };
  const results = await Promise.allSettled(deliveries);
  const sent = results.filter((r) => r.status === 'fulfilled').length;
  return { sent, total: deliveries.length };
}

export async function loadDedupState(kv) {
  if (!kv) return {};
  return (await kv.get(DEDUP_KV_KEY, 'json')) || {};
}

export async function saveDedupState(kv, state) {
  if (!kv) return;
  await kv.put(DEDUP_KV_KEY, JSON.stringify(state), { expirationTtl: DEDUP_TTL_SEC });
}

/**
 * Send an alert only once for a given dedup key + cycle token.
 */
export async function sendDedupedAlert(env, dedupState, key, cycleToken, message) {
  if (dedupState[key] === cycleToken) {
    return false;
  }
  const res = await sendAlert(env, message);
  if (res.sent > 0) {
    dedupState[key] = cycleToken;
    return true;
  }
  return false;
}
