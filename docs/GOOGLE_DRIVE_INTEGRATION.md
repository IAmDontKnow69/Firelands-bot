# Google Drive + Google Sheets Integration Plan

This project already syncs fixtures from Google Calendar into Discord and stores attendance/config locally (`data.json`, `config.json`).

If you want a **bi-directional sync** with Google Sheets (plus optional Google Drive backups), use this shape:

## Target architecture

1. **Source of fixtures**: Google Calendar → bot sync job → local DB (`data.json`) and/or `Fixtures` sheet.
2. **Source of attendance**: Discord button interactions → local DB immediately.
3. **Shared sync surface**: `Attendance` sheet in the same spreadsheet.
4. **Config sync**: Keep runtime config in `config.json`, mirror selected config keys to a `Config` sheet.
5. **Local-first reliability**: Local writes happen first; sheet sync retries in background.

## Suggested Google Sheet tabs

### `Fixtures`
- `eventId` (calendar event ID)
- `title`
- `date`
- `team`
- `discordMessageId`
- `updatedAt`

### `Mens Fixtures` / `Womens Fixtures`
- Same schema as `Fixtures`
- Auto-split by `team` so coaches can view each team in a dedicated tab

### `Attendance`
- `eventId`
- `userId`
- `username`
- `team`
- `status` (`attending` / `not_attending`)
- `updatedAt`

### `Config`
- `key` (dot path, e.g. `channels.teamChats.mens`)
- `value`
- `updatedAt`

### `Config IDs`
- `key`
- `value`
- `updatedAt`
- Contains only role/channel configuration paths from `roles.*` and `channels.*`

## Conflict strategy (important)

Use this priority model:
- If offline or Google API fails: write locally and mark as pending sync.
- On reconnect: upsert pending local changes to Sheets.
- If both local + sheet changed: resolve by `updatedAt` newest wins.

## Security and auth

- Use a **Google service account** JSON key (same pattern as calendar integration).
- Share the spreadsheet with the service account email.
- Required scopes:
  - `https://www.googleapis.com/auth/spreadsheets`

If you also want Drive file operations/backups:
- Add `https://www.googleapis.com/auth/drive.file`

## Rollout plan

1. Add sheet config fields (`spreadsheetId`, ranges, enabled flag).
2. Build sheet read/write utility (done in `utils/googleSheetsSync.js`).
3. Wire attendance write-through on button actions.
4. Add periodic backfill job local ↔ sheets.
5. Optionally add `/admin sync` command to force sync.

## Notes for this repo

- Keep Discord interaction handling fast: never block user response on sheet latency.
- Use local DB as the authoritative operational store.
- Treat Sheets as shared visibility and backup sync surface.


## Step-by-step: Google service account credentials setup

1. In Google Cloud Console, create/select a project for the bot.
2. Enable APIs in that project:
   - **Google Calendar API** (already needed by this bot)
   - **Google Sheets API**
   - **Google Drive API** (only if you need file backup operations)
3. Go to **IAM & Admin → Service Accounts** and create a service account (example name: `firelands-bot-sync`).
4. Open the service account and create a **JSON key**:
   - Service Account → **Keys** → **Add key** → **Create new key** → **JSON**.
   - Download the JSON key file.
5. Store the JSON key securely on your bot host, for example:
   - `./credentials.json` in the project root, or
   - `/opt/firelands/secrets/google-service-account.json`
6. Point the bot to that credentials file:
   - Set `CALENDAR_CREDENTIALS_PATH` (or `GOOGLE_APPLICATION_CREDENTIALS`) to the file path.
7. Share Google resources with the service account email (from the JSON `client_email`):
   - Share the **Google Calendar** with at least “See all event details”.
   - Share the **Google Sheet** with **Editor** access (for read/write attendance).
8. Add your spreadsheet ID to config/env:
   - `GOOGLE_SPREADSHEET_ID=<spreadsheet_id_from_sheet_url>`
9. Turn on sync:
   - `GOOGLE_SYNC_ENABLED=true`
10. Restart the bot and verify:
   - Calendar events still sync.
   - Attendance writes appear in `Attendance` tab.

### Minimal env example

```bash
# Discord/runtime values omitted for brevity
CALENDAR_CREDENTIALS_PATH=/opt/firelands/secrets/google-service-account.json
GOOGLE_SYNC_ENABLED=true
GOOGLE_SPREADSHEET_ID=1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890
GOOGLE_ATTENDANCE_RANGE=Attendance!A2:F
GOOGLE_FIXTURES_RANGE=Fixtures!A2:F
GOOGLE_MENS_FIXTURES_RANGE=Mens\ Fixtures!A2:F
GOOGLE_WOMENS_FIXTURES_RANGE=Womens\ Fixtures!A2:F
GOOGLE_CONFIG_RANGE=Config!A2:C
GOOGLE_CONFIG_IDS_RANGE=Config\ IDs!A2:C
```

### Common setup errors

- `The caller does not have permission`:
  - The calendar or spreadsheet was not shared with the service account email.
- `Requested entity was not found`:
  - Wrong spreadsheet ID or wrong calendar ID.
- `ENOENT ... credentials.json`:
  - Credentials file path is wrong; verify `CALENDAR_CREDENTIALS_PATH`.
- `insufficient authentication scopes`:
  - Ensure Sheets scope is included (`https://www.googleapis.com/auth/spreadsheets`).



## One-command sheet bootstrap

You can auto-create/update the expected worksheet tabs and headers:

```bash
CALENDAR_CREDENTIALS_PATH=/path/to/service-account.json \
node scripts/setupGoogleSheet.js "https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit"
```

This initializes:
- `Fixtures` with: `eventId,title,date,team,discordMessageId,updatedAt`
- `Mens Fixtures` with: `eventId,title,date,team,discordMessageId,updatedAt`
- `Womens Fixtures` with: `eventId,title,date,team,discordMessageId,updatedAt`
- `Attendance` with: `eventId,userId,username,team,status,updatedAt`
- `Config` with: `key,value,updatedAt`
- `Config IDs` with: `key,value,updatedAt`

If tabs already exist, headers are reset to the expected schema and row 1 is frozen.
