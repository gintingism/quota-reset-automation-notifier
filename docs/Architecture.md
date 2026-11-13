# Architecture

Quota Reset Automation Notifier runs on Cloudflare Workers (`src/index.js`) with a 5-minute Cron Trigger (`*/5 * * * *`) and a `QUOTA_KV` namespace for state.

## Components

- **`src/oauth.js`**: Exchanges `ANTIGRAVITY_REFRESH_TOKEN` for a Google OAuth2 `access_token` at `oauth2.googleapis.com/token` and caches it in `QUOTA_KV` (`oauth:access_token`) with a 5-minute refresh buffer. Raises `AuthRevokedError` on `invalid_grant`.
- **`src/cloudcode.js`**:
  - Calls `POST /v1internal:loadCodeAssist` on `daily-cloudcode-pa.googleapis.com` to resolve `cloudaicompanionProject` and tier (`cloudcode:project_info` cached for 24h).
  - Calls `POST /v1internal:fetchAvailableModels` and `POST /v1internal:retrieveUserQuotaSummary` using `User-Agent: antigravity/hub/2.24.0 linux/x64` so all quota pools (`Gemini Models`, `Claude and GPT models`, and `Gemini 4 Argon`) are returned.
  - Sends `"1+1"` to `POST /v1internal:streamGenerateContent?alt=sse` (`maxOutputTokens: 16`) when Auto-Wake triggers.
- **`src/wake_engine.js`**: Evaluates each `5H` pool (`Gemini Models`, `Claude and GPT models`) with 4 guards (`remaining_fraction >= 1.0`, 2-minute safety margin after `lastTriggeredResetAt`, 10-minute cooldown, and new `reset_time_iso`) plus `WAKE_TIME_WINDOW` and weekly quota > 0%.
- **`src/copilot.js`**: Calls `GET https://api.github.com/copilot_internal/user` when `GITHUB_TOKEN` is set to read monthly AI credits (`credits_used`, `credits_remaining`, `entitlement`, `quota_reset_date_utc`).
- **`src/notifier.js`**: Sends Telegram (`api.telegram.org/bot.../sendMessage`) and Discord webhook messages with retry/backoff and persistent deduplication in `QUOTA_KV` (`notify:dedup_state`).
- **`extension/`**: Chrome Manifest V3 extension that opens `gemini.google.com/usage` in a hidden `offscreen` iframe, scrapes English or Indonesian usage text, and posts `gemini_web` snapshots to `POST /api/quota/sync`.
