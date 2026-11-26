# Setup and Secrets

## Cloudflare Secrets

Set each secret with `npx wrangler secret put <NAME>`:

| Secret | Required | Purpose |
| :--- | :--- | :--- |
| `AUTH_TOKEN` | Yes | Protects `/api/*` endpoints and manual dashboard actions (`X-Auth-Token` header) |
| `ANTIGRAVITY_CLIENT_ID` | Yes | Google OAuth2 client ID for Antigravity |
| `ANTIGRAVITY_CLIENT_SECRET` | Yes | Google OAuth2 client secret for Antigravity |
| `ANTIGRAVITY_REFRESH_TOKEN` | Yes | Long-lived refresh token obtained via `npm run auth` |
| `TELEGRAM_BOT_TOKEN` | Optional | Bot token from `@BotFather` |
| `TELEGRAM_CHAT_ID` | Optional | Target chat ID for Telegram alerts |
| `DISCORD_WEBHOOK_URL` | Optional | Incoming webhook URL for Discord alerts |
| `GITHUB_TOKEN` | Optional | GitHub token (e.g. `gh auth token`) for GitHub Copilot AI credits tracking |
| `ANTIGRAVITY_ACCOUNTS` | Optional | JSON array of extra Antigravity accounts: `[{"id":"work","label":"Work","refreshToken":"1//..."}]` |
| `GCAL_CLIENT_ID` | Optional | Google Cloud OAuth2 client ID for Google Calendar & Tasks weekly reset sync |
| `GCAL_CLIENT_SECRET` | Optional | Google Cloud OAuth2 client secret for Google Calendar & Tasks |
| `GCAL_REFRESH_TOKEN` | Optional | Refresh token obtained via `npm run auth:calendar` |

## Getting `ANTIGRAVITY_REFRESH_TOKEN`

```powershell
$env:ANTIGRAVITY_CLIENT_ID = "<client-id>"
$env:ANTIGRAVITY_CLIENT_SECRET = "<client-secret>"
npm run auth
```

Open the printed Google OAuth URL, sign in, and copy `ANTIGRAVITY_REFRESH_TOKEN` from the terminal output.

## Getting `GCAL_REFRESH_TOKEN` (Google Calendar & Tasks)

Enable **Google Calendar API** and **Google Tasks API** in Google Cloud Console, create a **Desktop app** OAuth client, then run:

```powershell
$env:GCAL_CLIENT_ID = "<gcal-client-id>"
$env:GCAL_CLIENT_SECRET = "<gcal-client-secret>"
npm run auth:calendar
```

Open the printed URL, approve Calendar and Tasks access, and store `GCAL_CLIENT_ID`, `GCAL_CLIENT_SECRET`, and `GCAL_REFRESH_TOKEN` with `npx wrangler secret put`. Enable auto-sync from the dashboard or the extension's Settings tab.

## Installing the Chrome Extension (`extension/`)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `extension/` folder.
3. Click the extension icon and open the **Pengaturan / Settings** tab. Enter your Worker URL (`https://...workers.dev`) and `X-Auth-Token`, then click **Simpan pengaturan / Save settings**.
4. On the **Status** tab, click **Sinkronkan sekarang / Sync now**.
5. Use the `ID | EN` switch in the popup header to change the interface language.

`AUTH_TOKEN` is a value you choose yourself. Set it with `npx wrangler secret put AUTH_TOKEN` from the project folder, then enter the same value in the extension.
