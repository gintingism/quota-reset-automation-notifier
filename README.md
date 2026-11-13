# Quota Reset Automation Notifier

A small Cloudflare Worker that checks your Antigravity and GitHub Copilot quotas every 5 minutes, sends alerts to Telegram or Discord, and sends a minimal `"1+1"` prompt when a 5-hour Antigravity pool resets to 100% so the next 5-hour timer starts right away.

No desktop app needs to stay open for Antigravity or GitHub Copilot. For Gemini Web (`gemini.google.com/usage`), an optional Chrome extension in `extension/` reads the usage page in the browser and syncs it to the Worker.

## How it works

Every 5 minutes (`*/5 * * * *` in `wrangler.toml`), Cloudflare's `scheduled()` handler runs `runAutomationTick()` in `src/index.js`:

1. **Refreshes OAuth access token** (`src/oauth.js`) using `ANTIGRAVITY_REFRESH_TOKEN` and caches it in `QUOTA_KV`.
2. **Fetches Antigravity quota pools** (`src/cloudcode.js`) from `daily-cloudcode-pa.googleapis.com` using `/v1internal:loadCodeAssist`, `/v1internal:fetchAvailableModels`, and `/v1internal:retrieveUserQuotaSummary`:
   - **Gemini Models** (Weekly + 5h)
   - **Claude and GPT models** (Weekly + 5h)
   - **Gemini 4 Argon** (Weekly)
3. **Runs Auto-Wake per 5h pool** (`src/wake_engine.js`):
   - Checks each pool that has a `5H` window (`Gemini Models` -> `WAKE_GEMINI_MODEL`, `Claude and GPT models` -> `WAKE_CLAUDE_MODEL`).
   - Skips if the pool is below 100%, inside the 2-minute safety margin after a previous reset, within the 10-minute cooldown, already triggered for the same `reset_time_iso`, outside `WAKE_TIME_WINDOW`, or if its weekly limit is at 0%.
   - Sends `"1+1"` via `/v1internal:streamGenerateContent?alt=sse` (`maxOutputTokens: 16`) to lock in the next 5-hour countdown.
4. **Fetches GitHub Copilot AI credits** (`src/copilot.js`) from `api.github.com/copilot_internal/user` when `GITHUB_TOKEN` is set (monitoring + low-quota/monthly-reset alerts, no Auto-Wake).
5. **Keeps Gemini Web data synced** (`POST /api/quota/sync`) when pushed from the Chrome extension (`extension/`), and sends deduplicated alerts (`src/notifier.js`) to Telegram or Discord.

## Project files

- `src/index.js` — Worker `scheduled()` cron and HTTP router
- `src/oauth.js` — Google OAuth2 refresh token exchange and KV caching
- `src/cloudcode.js` — Cloud Code API client, quota pool parser, and SSE wake trigger
- `src/wake_engine.js` — 4-guard `shouldTriggerOnReset()` and active time window check
- `src/notifier.js` — Telegram/Discord sender with retry and KV deduplication
- `src/copilot.js` — Optional GitHub Copilot quota fetcher
- `src/dashboard.js` — HTML status page served at `GET /`
- `scripts/get-refresh-token.mjs` — One-time local OAuth helper to get `ANTIGRAVITY_REFRESH_TOKEN`
- `extension/` — Optional Chrome extension (`gemini.google.com/usage` scraper for EN/ID) that syncs Gemini Web limits to `/api/quota/sync`
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
- `WAKE_PROMPT` — Prompt text sent on wake (default `"1+1"`)
- `WAKE_MAX_OUTPUT_TOKENS` — Output token cap for wake requests (default `"16"`)
- `WAKE_TIME_WINDOW` — Optional local time window like `"07:00-23:00"`, or `""` for 24/7
- `TIMEZONE_OFFSET_HOURS` — Offset from UTC (default `"7"` for WIB / UTC+7)
- `LOW_QUOTA_THRESHOLD` — Alert when a window drops to or below this percentage (default `"20"`)
- `NOTIFY_ON_WAKE` / `NOTIFY_ON_RESET` — `"true"` or `"false"`

## Chrome extension (`extension/`)

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `extension/`.
2. Open the extension popup, enter your Worker URL and `X-Auth-Token`, click **Simpan Pengaturan**, then **Sync Sekarang**.
3. It scrapes `gemini.google.com/usage` (English and Indonesian UI) every 15 minutes while Chrome is open and posts the snapshot to `/api/quota/sync`.

## Tests

```powershell
npm test
```
