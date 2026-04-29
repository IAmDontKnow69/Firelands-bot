# 🔥 Firelands Bot

**Firelands Bot** is a professional Discord operations assistant for football clubs. ⚽️
It centralizes fixtures, attendance, absences, vacations, player profiles, coach workflows, and Google integrations into one polished command flow.

---

## 🚀 Core Features

- 📅 **Google Calendar → Discord Fixtures**
  - Pulls events from your selected Google Calendar.
  - Classifies event types and keeps fixture timelines organized.

- 📣 **Attendance Automation**
  - Posts event attendance prompts.
  - Tracks player/coach responses in real time.
  - Supports coach confirmation flow for non-attendance.

- 🌴 **Vacation + Absence Tracking**
  - Supports structured vacation periods and standard absences.
  - Vacation data is visible in UI and attendance reporting.
  - Exports both absences and vacations to Sheets with a clear `recordType` marker.

- 🧑‍💼 **Professional Admin/Coach/Player Panels**
  - `/admin` for full operations control.
  - `/coach` for next-games attendance + management actions.
  - `/player` for personal attendance, next 5 games, and vacation visibility.

- 📊 **Google Sheets Sync Hub**
  - Syncs fixtures, attendance, absences/vacations, player/coach management, config snapshots, and command logs.
  - Includes tab creation/maintenance behavior so the bot can operate with your chosen spreadsheet.

---

## 🧭 Discord Setup Flow (Recommended)

> This project is designed to be configured from inside Discord with guided bot UI flows. ✅

1. 🤖 **Invite the bot** to your server with required permissions.
2. 🛠️ Run **`/admin`** and open the admin panel.
3. 🏟️ Configure **Club Management** basics:
   - Admin logs channel
   - Bot command channel
   - Team role/channel mappings
4. 📗 Open **Google Tools** and connect:
   - your Calendar source
   - your target Google Sheet
5. 🔄 Run sync actions to populate fixtures and operational tabs.
6. 👕 Validate `/player` and `/coach` views with a real upcoming fixture.
7. ✅ Confirm absence/vacation workflows and coach moderation behavior.

---

## 🔗 Google Calendar + Google Sheets Flexibility

Firelands Bot is intentionally designed to work with **any supported Google Calendar** and **any Google Sheet** you choose. 🧠

### What this means in practice

- 🗓️ You can point the bot at a different Calendar and it will calibrate to that event source.
- 📄 You can point the bot at a different Spreadsheet and it will sync operational data to that destination.
- 🧩 The bot manages/uses its own operational tabs/ranges so the system remains structured and reliable.
- 🔄 You can re-sync at any time from Discord tools when fixtures or structures change.

### Typical Google-connected data flows

- Fixtures from Calendar → `Fixtures` + team fixture tabs.
- Attendance decisions → `Attendance`.
- Absence + vacation records → `Absences` (`recordType` identifies row type).
- Profiles/management notes → player/coach management tabs.
- Command activity + config backups → logging and recovery tabs.

---

## 🧑‍💻 Command Experience

- `/admin` 🧰
  - Full operations panel.
  - Team setup, Google tools, backups, management, and diagnostics.

- `/coach` 🧢
  - Team attendance snapshot for upcoming games.
  - Vacation-aware visibility.
  - Quick actions for player management and team checks.

- `/player` 👟
  - Personal attendance summary.
  - Upcoming vacation visibility.
  - Next 5 games with team + location context.

- `/attendance` 📋
  - Attendance report and availability workflows.

- `/confirm` ✅
  - Coach/staff confirmation tool for attendance ticket flow.

---

## 🗂️ Data & Operations

- `config.json` ⚙️ — runtime configuration and backup state.
- `data.json` 💾 — events, responses, profiles, absences, vacations, and internal workflow data.

---

## 🩺 Troubleshooting

- ❌ **No fixtures appear**
  - Verify the selected calendar source and sharing permissions.
- ❌ **Sheet sync fails**
  - Verify spreadsheet access permissions and configured sheet target.
- ⚠️ **Wrong tab/range behavior**
  - Re-open Google tools in Discord and validate current mapping/ranges.

For deeper implementation details, see: `docs/GOOGLE_DRIVE_INTEGRATION.md`. 📘

---

## 🤝 Contributing

- Keep changes scoped and production-safe. 🛡️
- Include clear testing notes with every PR. 🧪
- Prefer Discord flow consistency and operator UX clarity. 🎯

---

## 📄 License

No license file is currently included.
Add one (for example MIT) before public distribution.
