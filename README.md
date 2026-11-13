# Quota Reset Automation Notifier

A small Cloudflare Worker that watches your Antigravity (and optional GitHub Copilot) quota every 5 minutes, sends alerts to Telegram or Discord, and automatically sends a minimal `"hi"` prompt when a 5-hour quota pool resets to 100% so the next 5-hour timer starts right away.

No desktop app or local IDE needs to stay open.

## How it works

Every 5 minutes (`*/5 * * * *` in `wrangler.toml`), Cloudflare's `scheduled()` handler runs `runAutomationTick()` in `src/index.js`:

1. **Refreshes OAuth access token** (`src/oauth.js`) using `ANTIGRAVITY_REFRESH_TOKEN` and caches it in `QUOTA_KV`.
2. **Fetches live quota pools** (`src/cloudcode.js`) from `daily-cloudcode-pa.googleapis.com` using `/v1internal:loadCodeAssist`, `/v1internal:fetchAvailableModels`, and `/v1internal:retrieveUserQuotaSummary`:
   - **Gemini Models** (Weekly + 5h)
   - **Claude and GPT models** (Weekly + 5h)
   - **Gemini 4 Argon** (Weekly)
3. **Runs Auto-Wake per 5h pool** (`src/wake_engine.js`):
   - Checks each pool that has a `5H` window (`Gemini Models` -> `WAKE_GEMINI_MODEL`, `Claude and GPT models` -> `WAKE_CLAUDE_MODEL`).
   - Skips if the pool is not at 100%, inside the 2-minute safety margin after a previous reset, within the 10-minute cooldown, already triggered for the same `reset_time_iso`, outside `WAKE_TIME_WINDOW`, or if its weekly limit is at 0%.
   - Sends `"hi"` via `/v1internal:streamGenerateContent?alt=sse` (`maxOutputTokens: 16`) to lock in the new 5-hour countdown.
4. **Sends deduplicated alerts** (`src/notifier.js`) to Telegram and/or Discord and stores dedup state in `QUOTA_KV`.
5. **Optionally checks GitHub Copilot** (`src/copilot.js`) if `GITHUB_TOKEN` is set.

## Project files

- `src/index.js` — Worker `scheduled()` cron and HTTP router
- `src/oauth.js` — Google OAuth2 refresh token exchange and KV caching
- `src/cloudcode.js` — Cloud Code API client, quota pool parser, and SSE wake trigger
- `src/wake_engine.js` — 4-guard `shouldTriggerOnReset()` and active time window check
- `src/notifier.js` — Telegram/Discord sender with retry and KV deduplication
- `src/copilot.js` — Optional GitHub Copilot quota fetcher
- `src/dashboard.js` — HTML status page served at `GET /`
- `scripts/get-refresh-token.mjs` — One-time local OAuth helper to get `ANTIGRAVITY_REFRESH_TOKEN`
- `tests/automation.test.js` — Unit tests using `node:test`
- `wrangler.toml` — Worker bindings, cron schedule, and non-secret config

## Endpoints

- `GET /` — Web dashboard showing quota pools, reset timers, and manual controls
- `GET /health` — Public health check (`{"ok":true,"service":"quota-reset-automation"}`)
- `GET /api/quota/latest` — Latest normalized JSON snapshot (requires `X-Auth-Token`)
- `POST /api/quota/sync` — Push an external v1 snapshot to KV (requires `X-Auth-Token`)
- `POST /api/automation/tick` — Manually run one sync + auto-wake check (requires `X-Auth-Token`)
- `POST /api/automation/wake` — Force an immediate wake ping (requires `X-Auth-Token`)

## Setup

1. **Install dependencies and log in to Cloudflare**:
   ```powershell
   npm install
   npx wrangler login
   ```

2. **Get your Antigravity refresh token (one-time)**:
   ```powershell
   npm run auth
   ```
   Open the printed URL, sign in with your Google account, and copy the `ANTIGRAVITY_REFRESH_TOKEN`.

3. **Create a KV namespace** and put its `id` in `wrangler.toml` under `[[kv_namespaces]]`:
   ```powershell
   npx wrangler kv namespace create QUOTA_KV
   ```

4. **Set Cloudflare secrets**:
   ```powershell
   npx wrangler secret put AUTH_TOKEN
   npx wrangler secret put ANTIGRAVITY_CLIENT_ID
   npx wrangler secret put ANTIGRAVITY_CLIENT_SECRET
   npx wrangler secret put ANTIGRAVITY_REFRESH_TOKEN
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_CHAT_ID
   ```
   Optional secrets:
   ```powershell
   npx wrangler secret put DISCORD_WEBHOOK_URL
   npx wrangler secret put GITHUB_TOKEN
   ```

5. **Deploy**:
   ```powershell
   npm run deploy
   ```

## Configuration (`wrangler.toml`)

- `AUTO_WAKE_ENABLED` — `"true"` or `"false"`
- `WAKE_GEMINI_MODEL` — Default `"gemini-3-flash"`
- `WAKE_CLAUDE_MODEL` — Default `"claude-sonnet-5-5-medium"`
- `WAKE_PROMPT` — Prompt text sent on wake (default `"hi"`)
- `WAKE_MAX_OUTPUT_TOKENS` — Output token cap for wake requests (default `"16"`)
- `WAKE_TIME_WINDOW` — Optional local time window like `"07:00-23:00"`, or `""` for 24/7
- `TIMEZONE_OFFSET_HOURS` — Offset from UTC (default `"7"` for WIB / UTC+7)
- `LOW_QUOTA_THRESHOLD` — Alert when a window drops to or below this percentage (default `"20"`)
- `NOTIFY_ON_WAKE` / `NOTIFY_ON_RESET` — `"true"` or `"false"`

## Tests

```powershell
npm test
```
