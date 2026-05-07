# 🔥 Firelands United Discord Bot

Firelands Bot is a Discord operations hub for Firelands United teams. It combines player self-service, coach oversight, admin configuration, attendance tracking, vacation requests, Google Calendar fixture syncing, and Google Sheets reporting into guided Discord click flows.

The bot is designed so day-to-day club work happens from Discord panels instead of editing JSON files or asking players to respond in random chat threads.

---

## Table of Contents

- [What the Bot Does](#what-the-bot-does)
- [Primary User Flows](#primary-user-flows)
  - [`/player` Player Panel](#player-player-panel)
  - [`/coach` Coach Panel](#coach-coach-panel)
  - [`/admin panel` Admin Panel](#admin-panel-admin-panel)
- [Attendance Lifecycle](#attendance-lifecycle)
- [Vacation Lifecycle](#vacation-lifecycle)
- [Google Calendar and Google Sheets](#google-calendar-and-google-sheets)
- [Other Commands](#other-commands)
- [Runtime Data](#runtime-data)
- [Setup Checklist](#setup-checklist)
- [Operational Notes](#operational-notes)
- [Troubleshooting](#troubleshooting)
- [Local Development](#local-development)

---

## What the Bot Does

Firelands Bot manages club communication and reporting around fixtures, attendance, teams, profiles, and absences.

### Core capabilities

- **Player self-service** through `/player`:
  - profile viewing and editing,
  - fixture browsing,
  - next-event address lookup,
  - vacation request management,
  - coach chat request flow.
- **Coach operations** through `/coach`:
  - team dashboard,
  - coach profile management,
  - player profile lookup,
  - event review,
  - force attendance reminders,
  - team attendance reports,
  - vacation visibility,
  - player chat creation,
  - captain assignment,
  - next-event address lookup,
  - actual attendance verification,
  - attendance-list reminder settings.
- **Admin operations** through `/admin panel`:
  - team creation and team configuration,
  - player management,
  - coach management,
  - club-wide Google/configuration tools,
  - fixture settings,
  - Google Sheets backups,
  - coach role definitions,
  - club attendance report.
- **Attendance automation**:
  - sends attendance prompts,
  - records attending/not-attending responses,
  - opens absence review tickets when needed,
  - supports coach/staff confirmation,
  - tracks actual attendance after an event.
- **Vacation automation**:
  - players and coaches can request vacation windows,
  - coaches approve or decline vacation requests,
  - approved vacations affect event attendance visibility,
  - vacation records sync to Google Sheets.
- **Google integrations**:
  - Calendar events become bot fixtures,
  - fixture/attendance/config/profile data syncs to Sheets,
  - optional auto sync keeps external reporting current.

---

## Primary User Flows

## `/player` Player Panel

`/player` opens a private Player Hub for the signed-in player. The bot resolves the player from Discord roles and stored profile data, then shows the player only the teams they belong to.

### What players see first

The Player Hub now shows information in this order:

1. **Profile**
   - Discord mention,
   - full name,
   - first name,
   - last name,
   - gender,
   - nickname,
   - Discord server join date,
   - phone number.
2. **Attendance Summary**
   - attending,
   - not attending,
   - no response.
3. **Next 5 Games**
   - event title,
   - team,
   - event type,
   - date/time,
   - location,
   - current attendance status.
4. **Upcoming Vacation Times**
   - active or upcoming vacation records and statuses.

### Player Hub buttons

#### 1. `🪪 Profile Manager`

Click flow:

1. Player runs `/player`.
2. Player clicks **🪪 Profile Manager**.
3. Bot opens the player's profile management view.
4. Player can review stored identity/contact/profile details.
5. Profile changes feed the same profile record admins and coaches see in management screens.

Typical use:

- confirm the correct name is shown,
- check phone number formatting,
- check player photo/profile image status,
- make sure player details are ready for coach/admin views.

#### 2. `📅 Events/Fixtures`

Click flow:

1. Player runs `/player`.
2. Player clicks **📅 Events/Fixtures**.
3. Bot opens a paged fixture manager.
4. Player can browse future events and fixture history by page.
5. Player uses numbered event buttons and navigation buttons to move through events.

Fixture information includes:

- event title,
- team,
- event type,
- date/time,
- location,
- current attendance status.

#### 3. `📍 Next Event`

Click flow:

1. Player runs `/player`.
2. Player clicks **📍 Next Event**.
3. Bot replies privately with the next upcoming event for the player.
4. If a location exists, the bot includes an address and maps link.

Typical use:

- quickly find where the next game/practice is,
- avoid scrolling through the fixture list,
- open the location from a phone before driving.

#### 4. `🌴 Vacation`

Click flow:

1. Player runs `/player`.
2. Player clicks **🌴 Vacation**.
3. Bot opens the vacation management view.
4. Player can review vacation records and create or edit vacation requests.
5. When creating/editing, the bot asks for:
   - start date,
   - end date,
   - reason.
6. Bot creates a coach-review ticket and notifies team staff.
7. Coaches approve or decline the vacation.
8. Vacation status updates in the player's hub and Google Sheets sync data.

Vacation statuses include pending, approved, declined, and edited/pending-review states depending on the request lifecycle.

#### 5. `💬 Talk to your coaches`

Click flow:

1. Player runs `/player`.
2. Player clicks **💬 Talk to your coaches**.
3. Bot asks the player to choose which team/coaching group to contact when more than one team applies.
4. Bot creates a private coach chat/ticket with the player and relevant coaches.
5. Coaches can finish/close the chat when resolved.

Typical use:

- ask about availability,
- ask about roster expectations,
- discuss an absence,
- privately contact team staff without opening a public Discord conversation.

---

## `/coach` Coach Panel

`/coach` opens a coach dashboard. Coaches must have configured coach roles for at least one team. If a coach belongs to multiple teams, the bot asks which team to manage first.

### Coach team selection

Click flow:

1. Coach runs `/coach`.
2. If the coach has one team, the bot opens that team dashboard immediately.
3. If the coach has multiple teams, the bot shows a team select menu.
4. Coach selects the team.
5. Bot opens the Coach UI for that team.

### What coaches see first

The Coach UI includes:

- team label,
- next event information,
- attendance snapshot for upcoming events,
- team/player context,
- navigation buttons for profile, events, attendance, vacation, chat, captain, and actual attendance work.

### Coach UI buttons

#### 1. `🧢 Coach Profile`

Click flow:

1. Coach opens `/coach`.
2. Coach clicks **🧢 Coach Profile**.
3. Bot opens the coach's managed profile screen.
4. Coach can view and update profile-style fields used by the club.

Profile fields available to coach/admin management include:

- name,
- nickname,
- phone,
- notes,
- face image URL,
- gender,
- coaching initials,
- coaching title/role,
- attendance summary.

#### 2. `👥 Player Manager` / `👥 Player Profiles`

Click flow:

1. Coach opens `/coach`.
2. Coach clicks **👥 Player Manager** or **👥 Player Profiles**.
3. Bot shows a paged, numbered player list for the selected team.
4. Coach clicks a player number.
5. Bot opens that player's profile view.
6. Coach can review player details and attendance context.

Player profile data may include:

- real name,
- nickname,
- phone,
- gender,
- shirt number,
- player positions,
- team roles,
- face image,
- profile notes,
- attendance summary,
- absence history.

#### 3. `📅 Events`

Click flow:

1. Coach opens `/coach`.
2. Coach clicks **📅 Events**.
3. Bot asks whether to view:
   - **Your Events**, or
   - **All Events**.
4. Coach chooses the event scope.
5. Bot shows events with numbered buttons and page navigation.
6. Coach selects an event.
7. Bot shows event details and reminder options.

Event tools include:

- view scoped event list,
- page forward/back,
- select a specific event,
- view event attendance status,
- force attendance reminders for players who have not responded.

#### 4. `🔔 Force Remind` inside Events

Click flow:

1. Coach opens **📅 Events**.
2. Coach chooses event scope and selects an event.
3. Coach clicks **🔔 Force Remind**.
4. Bot shows reminder options:
   - remind everyone who has not responded,
   - pick one player to remind.
5. Bot sends the selected reminder.

This is used when a lineup or roster decision depends on missing attendance responses.

#### 5. `📊 Team Attendance`

Click flow:

1. Coach opens `/coach`.
2. Coach clicks **📊 Team Attendance**.
3. Bot shows team attendance with event-type filters:
   - **🏃 Practices**,
   - **⚽ Matches**,
   - **📌 Not Set**,
   - **📚 All**.
4. Coach changes filters with buttons.
5. Coach can export attendance data.
6. Coach can go back to team selection or back to `/coach`.

Team attendance views summarize availability and attendance across tracked fixtures.

#### 6. `🌴 Your Vacations`

Click flow:

1. Coach opens `/coach`.
2. Coach clicks **🌴 Your Vacations**.
3. Bot opens coach vacation management.
4. Coach can create or edit vacation requests using start date, end date, and reason.
5. Requests enter the same review/sync lifecycle as player vacations.

#### 7. `🌴 Team Vacations`

Click flow:

1. Coach opens `/coach`.
2. Coach clicks **🌴 Team Vacations**.
3. Bot replies privately with the team's vacation summary.
4. Coach can review player/coach vacation overlaps while planning upcoming events.

#### 8. `💬 Chat With Player` / `💬 Chat Player`

Click flow:

1. Coach opens `/coach`.
2. Coach clicks **💬 Chat With Player** or **💬 Chat Player**.
3. Bot shows a paged player picker.
4. Coach chooses the player.
5. Bot creates a private coach/player chat channel.
6. Staff can close the chat after the discussion is complete.

Typical use:

- follow up on missing attendance,
- clarify a vacation/absence,
- discuss roster or availability privately.

#### 9. `🅒 Set Captains`

Click flow:

1. Coach opens `/coach`.
2. Coach clicks **🅒 Set Captains**.
3. Bot shows team/player captain controls.
4. Coach selects or changes captain-related status.
5. Player displays update with captain/vice-captain formatting where supported.

Captain metadata affects rich player labels in the bot UI.

#### 10. `📍 Next Event Address`

Click flow:

1. Coach opens `/coach`.
2. Coach clicks **📍 Next Event Address**.
3. Bot replies privately with the team's next event title, time, location, description, and maps link when available.

#### 11. `✅ Actual Attendance`

Click flow:

1. Coach opens `/coach`.
2. Coach clicks **✅ Actual Attendance**.
3. Bot shows a paged event picker.
4. Coach selects the event that occurred.
5. Bot opens a roster page for that event.
6. Coach marks each player as:
   - **✅ Attended**, or
   - **❌ Absent**.
7. Bot saves actual attendance back to event response data.
8. Google sync can export the updated attendance state.

This is separate from pre-event availability. It records who actually showed up.

#### 12. `🔔 Attendance List Notification`

Click flow:

1. Coach opens `/coach`.
2. Coach clicks **🔔 Attendance List Notification**.
3. Bot shows reminder timing choices:
   - **1 hour before**,
   - **5 hours before**,
   - **24 hours before**,
   - **Off**.
4. Coach selects a timing.
5. Bot stores the setting in the coach profile.
6. Bot sends event attendance list reminders according to that preference.

---

## `/admin panel` Admin Panel

`/admin panel` opens the private Admin UI. Admin access is controlled by configured admin rules. When an admin channel is configured, the command must be used there.

### What admins see first

The Admin UI home includes:

- club next five events,
- attendance snapshots for those events,
- currently configured teams,
- main menu buttons:
  - **🛠️ Team Management**,
  - **👕 Player Management**,
  - **🧢 Coach Management**,
  - **🏟️ Club Management**,
  - **📊 Club Report**.

### Admin home click flows

#### 1. `🛠️ Team Management`

Click flow:

1. Admin runs `/admin panel`.
2. Admin clicks **🛠️ Team Management**.
3. Bot lists existing teams and badges.
4. Admin can click an existing team button or click **➕ Create Team**.
5. Selecting a team opens that team's settings page.
6. Admin uses the team's configuration buttons to manage identity, roles, channels, fixture mapping, and attendance behavior.

Team settings include:

##### Team identity

- **🏷️ Set Team Name** — open a modal to change the display name.
- **😀 Set Team/Captain/Vice Emojis** — configure team emoji, captain emoji, and vice-captain emoji.
- **🛡️ Set Team Badge** — store a badge image URL.

##### Team role/channel IDs

- **👕 Player Role ID** — select/configure the Discord role for team players.
- **🧢 Coach Role ID** — select/configure the Discord role for team coaches.
- **🫡 Captain Role ID** — select/configure the captain role.
- **💬 Team Chat ID** — select the team channel.
- **🧰 Staff Room ID** — select the staff/coaches channel.
- **🚫 Absence Category ID** — select the category for absence/vacation/private tickets.
- **⚧️ Team Gender** — set team gender rules used when assigning players.

##### Fixture and attendance tools

- **📝 Event Name Phrases** — configure exact title phrases used to identify team events.
- **🔁 Manually Assign Fixture** — pick a fixture and assign it to the team.
- **⚡ Auto Assign Fixtures** — auto-map calendar fixtures based on configured wording.
- **📆 Show Team Events** — display team events with pagination.
- **🗑️ Remove Fixture** — remove a fixture assignment.
- **⏱️ Automatic Sending** — choose automatic attendance-send window.
- **📣 Force Send Attendance** — manually send attendance prompts for next event, next 14 days, or next 30 days.

Automatic sending supports day-window choices such as 7, 14, 21, and 28 days.

#### 2. `👕 Player Management`

Click flow:

1. Admin runs `/admin panel`.
2. Admin clicks **👕 Player Management**.
3. Bot asks admin to pick a team or **Unattached Players**.
4. Admin chooses a team/player list.
5. Bot shows players by number with pagination.
6. Admin clicks a player number.
7. Bot opens that player's profile management screen.

Player management actions include:

- **🪪 Name** — edit player name fields.
- **🤿 Nickname** — edit nickname.
- **📞 Phone** — edit phone number.
- **🗒️ Notes** — open notes tools.
- **👕 Shirt Number for Teams** — set team shirt numbers.
- **🖼️ Face URL** — store a direct image URL.
- **⚧️ Gender** — set profile gender.
- **🧩 Teams** — assign/update player teams.
- **📍 Positions** — set player position tags.
- **📈 Attendance** — open detailed attendance history.

Attendance tools from a player profile include:

- event-type filters:
  - practices,
  - matches,
  - not set,
  - all,
- **📤 Export Attendance**,
- **🧾 Absence Reasons**,
- **📜 Ticket Logs**,
- back to profile navigation.

Notes tools support adding and viewing profile notes used by admins/coaches.

#### 3. `🧢 Coach Management`

Click flow:

1. Admin runs `/admin panel`.
2. Admin clicks **🧢 Coach Management**.
3. Bot fetches members with configured coach roles.
4. Bot displays coaches by number with pagination.
5. Admin clicks a coach number.
6. Bot opens the coach profile management screen.

Coach management actions include:

- **🪪 Name**,
- **🤿 Nickname**,
- **📞 Phone**,
- **🗒️ Notes**,
- **🔤 Coaching Initials**,
- **🖼️ Face URL**,
- **⚧️ Gender**,
- **🎓 Coaching Title**,
- **📈 Attendance**.

Coach title values are managed through Club Management → Coach Roles.

#### 4. `🏟️ Club Management`

Click flow:

1. Admin runs `/admin panel`.
2. Admin clicks **🏟️ Club Management**.
3. Bot shows club-wide configuration status.
4. Admin chooses one of the club tools.

Club Management buttons:

##### `📗 Google`

Click flow:

1. Admin opens **🏟️ Club Management**.
2. Admin clicks **📗 Google**.
3. Bot shows the current calendar source, last sync time, and auto-sync status.
4. Admin can use Google tool buttons.

Google tool buttons:

- **🔄 Sync Calendar → Fixtures** — sync Google Calendar data into bot fixtures and push bot data to Sheets.
- **📄 Open Google Sheet** — open the configured spreadsheet when available.
- **🗓️ Open Google Calendar** — open the configured calendar when available.
- **📆 Show Google Calendar Events** — display current synced calendar/fixture events.
- **🟢/🔴 Auto Sync** — turn automatic full sync on or off.

##### `🧰 Fixture Settings`

Click flow:

1. Admin opens **🏟️ Club Management**.
2. Admin clicks **🧰 Fixture Settings**.
3. Bot shows fixture classification and address tools.

Fixture Settings buttons:

- **🧭 Event Type Rules** — manage practice/match/other detection and exact title wording.
- **📍 Event Addresses** — list captured event locations and address aliases.
- **⬅️ Back** — return to Club Management.

Event Type Rules include:

- auto-detection toggle,
- practice wording rules,
- match wording rules,
- exact phrase mapping.

##### `🛎️ Set Admin Chat`

Click flow:

1. Admin opens **🏟️ Club Management**.
2. Admin clicks **🛎️ Set Admin Chat**.
3. Bot shows a Discord channel select menu.
4. Admin chooses the admin channel.
5. Bot stores it as the admin log/error/failure channel.

##### `💬 Set Bot Commands Chat`

Click flow:

1. Admin opens **🏟️ Club Management**.
2. Admin clicks **💬 Set Bot Commands Chat**.
3. Bot shows a Discord channel select menu.
4. Admin chooses where `/player` and `/coach` should be used.
5. Admin can also turn this restriction off.

##### `💾 Backups`

Click flow:

1. Admin opens **🏟️ Club Management**.
2. Admin clicks **💾 Backups**.
3. Bot shows backup controls.
4. Admin can click:
   - **➕ Save Backup**,
   - **♻️ Restore Backup**.
5. Save Backup opens a modal for backup name and slot 1–5.
6. Restore Backup opens a select menu of available backup slots.
7. Bot restores config/data from the chosen backup source.

##### `🎓 Coach Roles`

Click flow:

1. Admin opens **🏟️ Club Management**.
2. Admin clicks **🎓 Coach Roles**.
3. Bot shows configured coach title definitions and the default title.
4. Admin can click:
   - **➕ Add**,
   - **✏️ Edit**,
   - **🗑️ Remove**,
   - **✅ Set Default**.
5. Bot updates the role definitions used on coach profiles.

#### 5. `📊 Club Report`

Click flow:

1. Admin runs `/admin panel`.
2. Admin clicks **📊 Club Report**.
3. Bot generates a team-by-team attendance snapshot.
4. Report includes tracked event count and each player's totals:
   - attended,
   - absent/unavailable,
   - not responded.

---

## Attendance Lifecycle

Attendance can be collected automatically, manually, and through player button responses.

### Pre-event attendance

1. Calendar fixtures are synced into bot events.
2. Admins configure team roles/channels and fixture matching.
3. Admins use automatic sending or force-send attendance prompts.
4. Players receive attendance buttons:
   - **🟢 Attending**,
   - **🔴 Not Attending**.
5. If a player is attending, the response is stored immediately.
6. If a player is not attending, the bot asks for a reason.
7. The bot opens/uses an absence review flow for coach/staff confirmation where required.
8. Coaches can see missing responses and force reminders from `/coach`.

### Absence tickets and confirmation

When not-attending needs staff review:

1. Player submits a reason.
2. Bot creates an absence ticket/private channel when configured.
3. Staff review the absence.
4. Staff can confirm not attending or decline/ask the player to attend.
5. The result is reflected in attendance reports.

### Actual attendance

Actual attendance happens after the event:

1. Coach opens `/coach`.
2. Coach clicks **✅ Actual Attendance**.
3. Coach picks the completed event.
4. Coach reviews the roster.
5. Coach marks players as attended or absent.
6. Bot stores actual attendance separately from pre-event availability status.

---

## Vacation Lifecycle

Vacation requests are handled through player and coach panels.

1. User opens `/player` or `/coach`.
2. User clicks the vacation button.
3. User creates or edits a vacation request with:
   - start date,
   - end date,
   - reason.
4. Bot stores the vacation as pending.
5. Bot creates a review ticket/private channel for the relevant coaches.
6. Coaches receive approve/decline controls.
7. Approved vacations are visible in player/coach/admin views.
8. Vacation data syncs to Google Sheets with absence/vacation records.

Vacation-aware UI helps coaches see conflicts before events and helps players understand why a fixture may show them unavailable.

---

## Google Calendar and Google Sheets

Firelands Bot is built to operate with configurable Google Calendar and Google Sheet targets.

### Google Calendar

Calendar events are used as the source for fixtures. The bot can:

- read the configured calendar source,
- normalize calendar events into bot fixture records,
- classify events as practice, match, or not set/other,
- map events to teams using team phrases and manual assignment,
- expose event locations and maps links inside Discord panels.

### Google Sheets

Google Sheets is used as the operations/reporting destination. Sync flows include:

- fixtures,
- attendance responses,
- absence and vacation records,
- player and coach profiles,
- command logs,
- configuration snapshots,
- backup records.

The Admin UI provides sync, open-sheet, open-calendar, show-events, auto-sync, and backup controls.

For deeper Google integration notes, see [`docs/GOOGLE_DRIVE_INTEGRATION.md`](docs/GOOGLE_DRIVE_INTEGRATION.md).

---

## Other Commands

### `/attendance`

Attendance command group for reports and future availability.

Subcommands:

- `/attendance report` — show attendance report for upcoming events. Intended for coaches.
- `/attendance unavailable` — mark yourself unavailable for a future date with team, date, and reason.
- `/attendance available` — mark yourself available again for a future date.

### `/confirm`

Coach/staff confirmation command used with attendance ticket flows.

Typical use:

- confirm a player is not attending,
- complete staff review for an absence-related workflow.

### `/admin-config`

Administrative configuration command module used by the bot for config-oriented operations.

---

## Runtime Data

The bot stores operational data in local JSON files and can sync reporting data to Google Sheets.

### `config.json`

Stores runtime configuration such as:

- Discord guild ID,
- team definitions,
- role IDs,
- channel IDs,
- calendar ID,
- Google Sheet ID,
- sync settings,
- coach roles,
- fixture/event type rules,
- backup settings.

### `data.json`

Stores operational records such as:

- events/fixtures,
- attendance responses,
- profiles,
- absences,
- vacations,
- command logs,
- internal workflow metadata.

### Local-only metadata

Some internal data is intentionally local-only and not exported as normal Google Sheet reporting rows, including:

- future availability entries,
- post-event coach reminder flags,
- setup wizard progress/state metadata.

---

## Setup Checklist

Use this checklist for a new server or major reconfiguration.

1. Invite the Discord bot with the permissions it needs for slash commands, buttons, modals, private channels, role reads, and message sending.
2. Start the bot process.
3. Run `/admin panel` from an admin-approved account.
4. Open **🏟️ Club Management**.
5. Set **🛎️ Admin Chat**.
6. Optional: set **💬 Bot Commands Chat**.
7. Open **🛠️ Team Management**.
8. Create each team.
9. For each team, configure:
   - display name,
   - team emoji,
   - badge URL,
   - player role,
   - coach role,
   - captain role,
   - team chat,
   - staff room,
   - absence/private category,
   - team gender,
   - event name phrases.
10. Open **🏟️ Club Management → 📗 Google**.
11. Confirm calendar and spreadsheet settings.
12. Run **🔄 Sync Calendar → Fixtures**.
13. Use **🧰 Fixture Settings** to validate event type rules and addresses.
14. Use **🛠️ Team Management → Show Team Events** to confirm fixture assignment.
15. Test `/player` as a player.
16. Test `/coach` as a coach.
17. Force-send attendance for a small upcoming test event.
18. Confirm Google Sheets sync output.
19. Save a backup from **🏟️ Club Management → 💾 Backups**.

---

## Operational Notes

- Most panel responses are ephemeral/private so admin, coach, and player work does not flood public channels.
- Player and coach access depends heavily on correctly configured Discord roles.
- Team fixture quality depends on good Google Calendar event titles, team phrases, and manual corrections when needed.
- Phone number validation expects US-style 10-digit phone numbers.
- Face/profile image URLs should be direct image links ending in `.png`, `.webp`, `.jpg`, or `.jpeg`.
- Google sync requires valid Google service credentials and access to the configured calendar/sheet.
- If the bot command channel is enabled, `/player` and `/coach` should be used in that configured channel.
- If the admin channel is enabled, `/admin panel` should be used in that configured admin channel.

---

## Troubleshooting

### No player teams show in `/player`

Check:

- player has the correct Discord player role,
- team player role ID is configured,
- role ID is not left as `ROLE_ID`,
- profile stored roles are current if using fallback profile data.

### Coach cannot open `/coach`

Check:

- coach has the configured coach role,
- coach role ID is configured for the team,
- command is being used in the allowed bot command channel if that restriction is enabled.

### `/admin panel` refuses access

Check:

- admin access configuration,
- admin role/user rules,
- admin command is being used in the configured admin channel.

### Fixtures are missing

Check:

- Google Calendar ID/source,
- Google credentials,
- calendar sharing/access permissions,
- sync status in **🏟️ Club Management → 📗 Google**,
- team event phrases and manual assignment.

### Attendance prompts are not sending

Check:

- team chat channel ID,
- bot permissions in the team channel,
- automatic sending window,
- event date range,
- fixture assignment to the correct team.

### Vacation tickets are not created

Check:

- absence/private category ID,
- bot permission to create/manage channels,
- coach role IDs,
- guild/channel permissions.

### Google Sheets sync fails

Check:

- spreadsheet ID,
- service account access to the sheet,
- Google credentials,
- network/runtime logs,
- sync status in Google Tools.

---

## Local Development

### Requirements

- Node.js compatible with Discord.js v14.
- Discord bot token and application setup.
- Google API credentials if using Calendar/Sheets sync.

### Install dependencies

```bash
npm install
```

### Start the bot

```bash
npm start
```

The start script runs `node index.js`.

### Key files

- `index.js` — bot startup and command registration/runtime wiring.
- `commands/player.js` — `/player` command and Player Hub payload.
- `commands/coach.js` — `/coach` command and Coach UI entry point.
- `commands/admin.js` — `/admin panel` command and Admin UI entry point.
- `commands/attendance.js` — attendance report and availability command group.
- `commands/confirm.js` — confirmation command flow.
- `events/interactionCreate.js` — button, select-menu, modal, attendance, vacation, and panel click-flow handling.
- `utils/database.js` — local data helpers.
- `utils/googleCalendar.js` — Google Calendar helpers.
- `utils/googleSheetsSync.js` — Google Sheets sync helpers.
- `utils/reminders.js` — reminder/attendance prompt helpers.
- `docs/GOOGLE_DRIVE_INTEGRATION.md` — Google integration details.

---

## License

No license file is currently included. Add a license before public distribution.
