const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const {
  loadDb,
  saveDb,
  setResponse,
  clearResponse,
  setAbsenceTicket,
  deleteAbsenceTicket,
  setEventMessageId,
  upsertPlayerProfile,
  getPlayerProfile,
  getPlayerDisplayName
} = require('../utils/database');
const { loadConfig, updateConfig, restoreConfigFromBackup, resetConfigFresh, saveConfig } = require('../utils/config');
const { getTeamSetupProgress } = require('../utils/teamSetup');
const { fetchCalendarEvents, titleMatchesPhrase } = require('../utils/googleCalendar');
const {
  syncAllToSheet,
  syncConfigOnlyToSheet,
  appendCommandLogRow,
  loadSheetBackups,
  saveSheetBackupSlot,
  buildSpreadsheetBackupSnapshot,
  restoreSpreadsheetFromBackupSnapshot,
  loadConfigFromSheet
} = require('../utils/googleSheetsSync');
const coachCommand = require('../commands/coach');
const adminCommand = require('../commands/admin');
const { hasAdminAccess, adminAccessMessage } = require('../utils/adminAccess');
const { determineEventType, eventTypeLabel, getEventTypeConfig } = require('../utils/eventType');

function getTeamMeta(config = {}, team = '') {
  const teamConfig = config.teams?.[team] || {};
  return {
    label: teamConfig.label || team,
    emoji: teamConfig.emoji || '🔹'
  };
}


function getGoogleToolsSummary(config = {}) {
  const calendarId = config.bot?.calendarId || 'not set';
  const lastSyncedAt = config.googleSync?.lastSyncedAt;
  const lastSyncedLabel = lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : 'never';
  return [
    '📗 **Google Tools**',
    `Current calendar source: **${calendarId}**`,
    `Last calendar/sheets sync: **${lastSyncedLabel}**`,
    '',
    'What each button does:',
    '• Sync Google Sheets: force sync fixtures/attendance/config into the sheet.',
    '• Open Google Sheet: opens the configured spreadsheet URL.',
    '• Set Google Calendar ID: choose which calendar fixtures are pulled from.',
    '• View Google Calendar Events: import and preview fixtures from Google Calendar.',
    '• Event Addresses: list event addresses captured from fixtures.',
    '• Set Address Nickname: map venue addresses to readable nicknames.'
  ].join('\n');
}

function getTeamManagementSummary() {
  return [
    '🛠️ **Team Management**',
    'Choose a team button to open its setup panel.',
    '',
    'Buttons in this menu:',
    '• Team button — open that team settings page.',
    '• ➕ Create Team — add a new team key and label to config.',
    '• ⬅️ Back — return to the Admin home menu.'
  ].join('\n');
}

function getClubManagementSummary() {
  return [
    '🏟️ **Club Management**',
    'Configure club-wide settings and integrations.',
    '',
    'Buttons in this menu:',
    '• 📗 Google — open Google tools (calendar/sheets/addresses).',
    '• 🛎️ Set Admin Chat — choose the admin log + failure channel.',
    '• 💬 Set Bot Commands Chat — choose where /player and /coach should run.',
    '• 💾 Backups — save/restore sheet snapshots.',
    '• 🧭 Event Type Rules — manage event type detection rules.',
    '• ⬅️ Back — return to Admin home.'
  ].join('\n');
}

function getPlayerManagementSummary() {
  return [
    '👕 **Player Management**',
    'Select a player from the menu to edit profile details, teams, notes, roles, and attendance.'
  ].join('\n');
}

function getCoachManagementSummary() {
  return [
    '🧢 **Coach Management**',
    'Only users with configured coach roles are listed.',
    'Select a coach to edit profile details and coaching assignments.'
  ].join('\n');
}

function teamAllowsGender(teamGender = '', playerGender = '') {
  const teamValue = String(teamGender || '').toLowerCase();
  const playerValue = String(playerGender || '').toLowerCase();
  if (!teamValue || teamValue === 'mixed') return true;
  if (!playerValue) return true;
  return teamValue === playerValue;
}

function getGenderMismatchMessage(teamLabel = 'team', teamGender = '') {
  const normalized = String(teamGender || '').toLowerCase();
  if (normalized === 'male') return `${teamLabel} is a male team. Your profile gender does not match.`;
  if (normalized === 'female') return `${teamLabel} is a female team. Your profile gender does not match.`;
  return `Your profile gender does not match ${teamLabel} requirements.`;
}

function createAdminQuickActionRow() {
  return adminCommand.createAdminPanelActionRow();
}

function createAdminQuickActionExtraRow() {
  return adminCommand.createAdminPanelSecondaryRow();
}

function withOptionalRow(rows = []) {
  return rows.filter(Boolean);
}

function createAdminBackButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_back_to_panel')
      .setLabel('⬅️ Back')
      .setStyle(ButtonStyle.Secondary)
  );
}

function createBackButtonRow(customId = 'admin_back_to_panel', label = '⬅️ Back') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(ButtonStyle.Secondary)
  );
}

function createTeamManagementRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_team_management:new_team')
      .setLabel('➕ Create Team')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('admin_back_to_panel')
      .setLabel('⬅️ Back')
      .setStyle(ButtonStyle.Secondary)
  );
}

function createClubManagementRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_club_action:google').setLabel('📗 Google').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_club_action:set_admin_chat').setLabel('🛎️ Set Admin Chat').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_club_action:set_bot_commands_chat').setLabel('💬 Set Bot Commands Chat').setStyle(ButtonStyle.Secondary)
  );
}

function createClubManagementRow2() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_club_action:backups').setLabel('💾 Backups').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_club_action:event_type_rules').setLabel('🧭 Event Type Rules').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_back_to_panel').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
  );
}

function createGoogleToolsRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_google_action:sync_google').setLabel('🔄 Sync Calendar → Fixtures').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_google_action:open_google_sheet').setLabel('📄 Open Google Sheet').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_google_action:set_calendar_id').setLabel('🗓️ Set Google Calendar ID').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_google_action:view_google_events').setLabel('📆 View Google Calendar Events').setStyle(ButtonStyle.Secondary)
  );
}

function createGoogleToolsRow2() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_google_action:view_event_locations').setLabel('📍 Event Addresses').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_google_action:set_location_nickname').setLabel('🏷️ Set Address Nickname').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_back_club_management').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
  );
}

function createEventTypeRulesRow(config = loadConfig()) {
  const autoDetectEnabled = getEventTypeConfig(config).autoDetect;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_event_type_rule:toggle_auto_detect')
      .setLabel(autoDetectEnabled ? '🛑 Turn OFF Auto Detect' : '✅ Turn ON Auto Detect')
      .setStyle(autoDetectEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('admin_event_type_rule:set_practice_exact').setLabel('📝 Practice Exact Names').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_event_type_rule:set_match_exact').setLabel('🏁 Match Exact Names').setStyle(ButtonStyle.Secondary)
  );
}

function createEventTypeRulesRow2() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('admin_event_type_rule:set_other_exact').setLabel('🧩 Other Exact Names').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_event_type_rule:manual_set_event_type').setLabel('🎯 Manual Event Type').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_back_club_management').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
  );
}

function createTeamPickerRow(config, customId, placeholder = 'Choose a team') {
  const options = Object.keys(config.teams || {}).map((team) => {
    const meta = getTeamMeta(config, team);
    return { label: `${meta.emoji} ${meta.label}`.slice(0, 100), value: team };
  });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .addOptions(options.slice(0, 25))
  );
}

function createTeamConfigActionRow(config, team) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`admin_team_config_action:${team}:id_settings`).setLabel('🪪 ID Settings').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`admin_team_config_action:${team}:fixtures_settings`).setLabel('📅 Fixture Settings').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`admin_team_config_action:${team}:team_name`).setLabel('🏷️ Set Team Name').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_team_config_action:${team}:team_emojis`).setLabel('😀 Set Team/Captain Emojis').setStyle(ButtonStyle.Secondary)
  );
}

function isConfiguredId(value) {
  return Boolean(value && value !== 'ROLE_ID');
}

function createTeamConfigIdSettingsRows(team, config = loadConfig()) {
  const playerRoleSet = isConfiguredId(config.roles?.[team]?.player);
  const coachRoleSet = isConfiguredId(config.roles?.[team]?.coach);
  const captainRoleSet = isConfiguredId(config.teams?.[team]?.captainRoleId);
  const teamChatSet = isConfiguredId(config.channels?.teamChats?.[team]);
  const staffRoomSet = isConfiguredId(config.channels?.staffRooms?.[team]);
  const privateCategorySet = isConfiguredId(config.channels?.privateChatCategories?.[team]);

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`admin_team_config_action:${team}:player_role`).setLabel('👕 Player Role ID').setStyle(playerRoleSet ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`admin_team_config_action:${team}:coach_role`).setLabel('🧢 Coach Role ID').setStyle(coachRoleSet ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`admin_team_config_action:${team}:captain_role`).setLabel('🫡 Captain Role ID').setStyle(captainRoleSet ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`admin_team_config_action:${team}:team_chat`).setLabel('💬 Team Chat ID').setStyle(teamChatSet ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`admin_team_config_action:${team}:staff_room`).setLabel('🧰 Staff Room ID').setStyle(staffRoomSet ? ButtonStyle.Success : ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`admin_team_config_action:${team}:private_category`).setLabel('🚫 Absence Category ID').setStyle(privateCategorySet ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`admin_team_config_action:${team}:team_gender`).setLabel('⚧️ Team Gender').setStyle(isConfiguredId(config.teams?.[team]?.gender) ? ButtonStyle.Success : ButtonStyle.Danger)
    )
  ];
}

async function refreshFixtureSettingsMessage(interaction, team) {
  if (!interaction.message?.edit) return;
  const latestConfig = loadConfig();
  await interaction.message.edit({
    content: `${getTeamConfigSummary(latestConfig, interaction.guild, team)}\n\n**Fixture settings**`,
    embeds: [],
    components: [createTeamConfigFixtureSettingsRow(team), createBackButtonRow(`admin_back_team_config:${team}`)]
  }).catch(() => null);
}

function createTeamConfigFixtureSettingsRow(team) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`admin_team_config_action:${team}:event_name_phrases`).setLabel('📝 Event Name Phrases').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_team_config_action:${team}:fixture_team`).setLabel('🔁 Set Fixture Team').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_team_config_action:${team}:auto_assign_fixtures`).setLabel('⚡ Auto Assign Fixtures').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_team_config_action:${team}:force_send_attendance`).setLabel('📣 Force Send Attendance').setStyle(ButtonStyle.Secondary)
  );
}

function getUpcomingFixtures(db = {}) {
  return Object.entries(db.events || {})
    .map(([id, event]) => ({ id, ...event }))
    .filter((event) => new Date(event.date).getTime() >= Date.now())
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

function createFixturePagerRows(config, team, page = 0, events = []) {
  const perPage = 9;
  const totalPages = Math.max(1, Math.ceil(events.length / perPage));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const pageItems = events.slice(safePage * perPage, safePage * perPage + perPage);

  const numberRow = new ActionRowBuilder();
  pageItems.forEach((event, index) => {
    numberRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`admin_fixture_pick:${team}:${event.id}:${safePage}`)
        .setLabel(String(index + 1))
        .setStyle(ButtonStyle.Primary)
    );
  });

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`admin_fixture_page:${team}:${Math.max(0, safePage - 1)}`).setLabel('<').setStyle(ButtonStyle.Secondary).setDisabled(safePage <= 0),
    new ButtonBuilder().setCustomId(`admin_fixture_page:${team}:${Math.min(totalPages - 1, safePage + 1)}`).setLabel('>').setStyle(ButtonStyle.Secondary).setDisabled(safePage >= totalPages - 1),
    new ButtonBuilder().setCustomId(`admin_back_team_config:${team}`).setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
  );

  const lines = pageItems.map((event, index) => {
    const when = new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${index + 1}. ${when} — ${event.title} (Current: ${getTeamMeta(config, event.team).label || 'Unassigned'})`;
  });

  return {
    text: [`Pick fixture for **${getTeamMeta(config, team).label}** (page ${safePage + 1}/${totalPages})`, ...lines].join('\n'),
    rows: pageItems.length ? [numberRow, navRow] : [navRow]
  };
}

function createTeamPickerButtonsRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('admin_create_team_btn')
      .setLabel('➕ Create New Team')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('admin_back_to_panel')
      .setLabel('⬅️ Back')
      .setStyle(ButtonStyle.Secondary)
  );
}

function createTeamButtonsRows(config = {}) {
  const rows = [];
  let current = new ActionRowBuilder();
  let count = 0;

  for (const [team, meta] of Object.entries(config.teams || {})) {
    if (count === 5) {
      rows.push(current);
      current = new ActionRowBuilder();
      count = 0;
    }
    const style = team === 'womens'
      ? ButtonStyle.Danger
      : team === 'mens'
        ? ButtonStyle.Primary
        : ButtonStyle.Secondary;
    current.addComponents(
      new ButtonBuilder()
        .setCustomId(`admin_open_team:${team}`)
        .setLabel(`${meta?.emoji || '🔹'} ${meta?.label || team}`.slice(0, 80))
        .setStyle(style)
    );
    count += 1;
  }

  if (count > 0) rows.push(current);
  return rows;
}

function formatConfigRef(guild, type, id) {
  if (!id || id === 'ROLE_ID') return 'not set';
  if (type === 'role') {
    const role = guild.roles.cache.get(id);
    return role ? `<@&${id}>` : `${id} (missing)`;
  }
  const channel = guild.channels.cache.get(id);
  return channel ? `<#${id}>` : `${id} (missing)`;
}

function getTeamConfigSummary(config, guild, team) {
  const meta = getTeamMeta(config, team);
  const progress = getTeamSetupProgress(config, team);
  return [
    `⚙️ Now Configuring: ${meta.emoji} ${meta.label} (\`${team}\`)`,
    `Setup progress: **${progress.completed}/${progress.total} (${progress.percent}%)** ${progress.isComplete ? '✅ Ready' : '⚠️ Incomplete'}`,
    '',
    '🧩 **Current configuration**',
    `• 👕 Player Role: ${formatConfigRef(guild, 'role', config.roles?.[team]?.player)}`,
    `• 🧢 Coach Role: ${formatConfigRef(guild, 'role', config.roles?.[team]?.coach)}`,
    `• ⚧️ Team Gender: ${(config.teams?.[team]?.gender || 'not set').toString()}`,
    `• 💬 Team Chat: ${formatConfigRef(guild, 'channel', config.channels?.teamChats?.[team])}`,
    `• 🧰 Staff Room: ${formatConfigRef(guild, 'channel', config.channels?.staffRooms?.[team])}`,
    `• 🚫 Absence Chat Category: ${formatConfigRef(guild, 'channel', config.channels?.privateChatCategories?.[team])}`,
    `• 😀 Team Emoji: ${meta.emoji}`,
    `• 🫡 Captain Role: ${formatConfigRef(guild, 'role', config.teams?.[team]?.captainRoleId)}`,
    `• 🅒 Captain Emoji: ${config.teams?.[team]?.captainEmoji || 'not set'}`,
    `• 📝 Event Name Phrases (exact): ${(config.teams?.[team]?.eventNamePhrases || []).join(', ') || 'not set'}`,
    '',
    !progress.isComplete
      ? `⚠️ Missing required IDs: ${progress.missing.join(', ')}`
      : '✅ All required IDs are configured for this team.'
  ].join('\n');
}

function buildTeamMatchers(config = {}) {
  return Object.fromEntries(
    Object.entries(config.teams || {}).map(([teamKey, meta]) => [
      teamKey,
      Array.isArray(meta?.eventNamePhrases) ? meta.eventNamePhrases : []
    ])
  );
}

const pendingFixtureCorrections = new Map();
const pendingAbsenceReasonModals = new Map();
const pendingPlayerAttendDmTokens = new Map();
const pendingLocationAliasSelections = new Map();
const pendingSheetBackupWrites = new Map();
const pendingSheetBackupOverwriteConfirms = new Map();

function formatEtaMs(ms = 0) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function progressLines({ title = '', percent = 0, etaMs = 0, currentTab = '', tabs = [] } = {}) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  const tabList = tabs.length ? tabs.map((tab) => `• ${tab}${tab === currentTab ? ' ⏳' : ''}`).join('\n') : '• no tabs';
  return [
    title,
    '',
    `Progress: **${safePercent}%**`,
    `Estimated time remaining: **${formatEtaMs(etaMs)}**`,
    currentTab ? `Current tab: **${currentTab}**` : 'Current tab: starting…',
    '',
    'Tabs included:',
    tabList
  ].join('\n');
}

function normalizeLocation(value = '') {
  return String(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

function getMapsLink(location = '') {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

function encodeAliasKey(eventType = 'any', location = '') {
  return Buffer.from(`${eventType}|${normalizeLocation(location)}`).toString('base64url');
}

function getLocationNickname(config, eventType, location) {
  const aliases = config.googleSync?.locationAliases || {};
  const typed = aliases[encodeAliasKey(eventType, location)];
  if (typed) return typed;
  return aliases[encodeAliasKey('any', location)] || '';
}

function formatLocationForFixture(event, config) {
  if (!event.location) return '';
  const eventType = determineEventType(event, config);
  const nickname = getLocationNickname(config, eventType, event.location);
  const label = nickname || event.location;
  return `📍 [${label}](${getMapsLink(event.location)})`;
}

function buildLocationGroupsFromEvents(events, config) {
  const grouped = new Map();

  for (const event of events) {
    if (!event.location) continue;
    const eventType = determineEventType(event, config);
    const key = `${eventType}|${normalizeLocation(event.location)}`;
    const existing = grouped.get(key) || {
      eventType,
      location: event.location.trim(),
      count: 0
    };
    existing.count += 1;
    grouped.set(key, existing);
  }

  return Array.from(grouped.values()).sort((a, b) => b.count - a.count || a.location.localeCompare(b.location));
}

function createForceAttendanceWindowRow(team) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`admin_force_attendance_window:${team}`)
      .setPlaceholder('Choose force-send window')
      .addOptions([
        { label: 'Next event only', value: 'next_event', description: 'Send attendance for the next fixture only' },
        { label: 'Next 14 days', value: 'next_14_days', description: 'Send all fixtures in the next 14 days' },
        { label: 'Next 30 days', value: 'next_30_days', description: 'Send all fixtures in the next 30 days' }
      ])
  );
}

async function postAttendancePromptForEvent(interaction, event, config) {
  const teamChatChannelId = config.channels.teamChats?.[event.team];
  const eventsChannelId = teamChatChannelId || config.channels.events;
  if (!eventsChannelId) throw new Error('Events channel ID is not configured.');

  const channel = await interaction.client.channels.fetch(eventsChannelId);
  if (!channel || !channel.isTextBased()) throw new Error('Events channel not found or not text based.');

  const teamRoleId = config.roles?.[event.team]?.player;
  if (!teamRoleId || teamRoleId === 'ROLE_ID') throw new Error(`Player role is not configured for ${event.team}.`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`attend_yes:${event.id}`).setLabel('🟢 Attending').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`attend_no:${event.id}`).setLabel('🔴 Not Attending').setStyle(ButtonStyle.Danger)
  );

  const message = await channel.send({
    content: [
      `<@&${teamRoleId}>`,
      `📅 ${event.title}`,
      `🕒 ${new Date(event.date).toLocaleString()}`,
      event.location ? `📍 ${event.location}` : null,
      'Please mark your availability now.'
    ].filter(Boolean).join('\n'),
    components: [row]
  });

  setEventMessageId(event.id, message.id);
}

function buildMonthGroupedEventLines(events, db, guild, teamRolesMap, config) {
  const sorted = [...events].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (!sorted.length) return ['No upcoming events found.'];

  const lines = [];
  let activeMonth = '';

  for (const event of sorted) {
    const date = new Date(event.date);
    const monthLabel = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    if (monthLabel !== activeMonth) {
      activeMonth = monthLabel;
      if (lines.length) lines.push('');
      lines.push(`__**${monthLabel}**__`);
    }

    const attendance = summarizeAttendance(event, db, guild, teamRolesMap);
    const shortTitle = event.title.length > 70 ? `${event.title.slice(0, 67)}...` : event.title;
    const locationLine = formatLocationForFixture(event, config);
    lines.push([
      `• **${shortTitle}**`,
      `  🕒 ${date.toLocaleString()}`,
      `  👥 ${formatTeamLabel(event, config)}`,
      locationLine ? `  ${locationLine}` : null,
      `  ${attendance}`,
      ''
    ].filter(Boolean).join('\n'));
  }

  return lines;
}

function createEventScopePickerRow(config) {
  const teamOptions = Object.keys(config.teams || {}).slice(0, 24).map((team) => {
    const meta = getTeamMeta(config, team);
    return {
      label: `${meta.emoji} ${meta.label}`.slice(0, 100),
      value: team,
      description: `Show fixtures for ${meta.label}`.slice(0, 100)
    };
  });

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_view_events_scope')
      .setPlaceholder('Choose fixture scope')
      .addOptions([
        { label: 'All Teams', value: 'all', description: 'Show fixtures for every team/event' },
        ...teamOptions
      ].slice(0, 25))
  );
}

function renderProgressBar(percent = 0) {
  const normalized = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round(normalized / 10);
  return `${'🟩'.repeat(filled)}${'⬜'.repeat(10 - filled)} ${normalized}%`;
}

function renderProgressMessage(percent = 0, label = 'Working...') {
  const done = percent >= 100 ? '\n✅ Complete.' : '';
  return `⏳ ${label}\n${renderProgressBar(percent)}${done}`;
}

async function setProgressReply(interaction, percent, label, options = {}) {
  await interaction.editReply({
    content: renderProgressMessage(percent, label),
    embeds: options.embeds || [],
    components: options.components || []
  });
}

function parseCustomId(customId) {
  const [action, eventId, userId] = customId.split(':');
  return { action, eventId, userId };
}

function hasRole(member, roleId) {
  return !!member.roles.cache.get(roleId);
}

function getResponderMeta(response = {}) {
  if (response.responderType === 'coach') return { label: 'Coach', emoji: '🧢' };
  return { label: 'Player', emoji: '👕' };
}

function createAbsenceLogRow(ticketChannelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`absence_ticket_log:${ticketChannelId}`)
      .setLabel('📜 View Absence Log')
      .setStyle(ButtonStyle.Secondary)
  );
}

function createAbsenceNotificationRow(ticketChannelId, userId, mode = 'coach', closed = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`absence_ticket_log:${ticketChannelId}`)
      .setLabel('📜 Absence Log')
      .setStyle(ButtonStyle.Secondary)
  );
}

function formatAbsenceNotification(ticket = {}, event = {}, status = 'open') {
  const playerName = ticket.playerName || `<@${ticket.playerId}>`;
  const eventLabel = event?.title || ticket.eventId || 'Unknown event';
  const dateLabel = event?.date ? getCompactDateLabel(event.date) : 'unknown date';
  if (status === 'closed') {
    return [
      `✅ Absence Ticket Closed`,
      `👤 ${playerName}`,
      `📅 ${dateLabel} — ${eventLabel}`
    ].join('\n');
  }
  return [
    `🚨 New Absence Ticket Open`,
    `👤 ${playerName}`,
    `📅 ${dateLabel} — ${eventLabel}`,
    `Status: OPEN`
  ].join('\n');
}

function sanitizeChannelName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

function chunkLines(lines, size = 20) {
  const chunks = [];
  for (let i = 0; i < lines.length; i += size) chunks.push(lines.slice(i, i + size));
  return chunks;
}

function getEventDateLabel(eventDate) {
  return new Date(eventDate).toISOString().slice(0, 10);
}

function getCompactDateLabel(eventDate) {
  const date = new Date(eventDate);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const yy = String(date.getUTCFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

function getPlayerNameForUi(user, member, profile) {
  return profile?.customName || profile?.nickName || member?.displayName || user?.globalName || user?.username || 'Player';
}

function getUserTeamFromMember(member, config, mode = 'player') {
  return Object.keys(config.teams || {}).find((teamKey) => {
    const roleId = mode === 'coach' ? config.roles?.[teamKey]?.coach : config.roles?.[teamKey]?.player;
    return roleId && roleId !== 'ROLE_ID' && member?.roles?.cache?.has(roleId);
  }) || '';
}

function getCaptainSuffix(config, team, member) {
  const captainRoleId = config.teams?.[team]?.captainRoleId;
  if (!captainRoleId || !member?.roles?.cache?.has(captainRoleId)) return '';
  return config.teams?.[team]?.captainEmoji || '🅒';
}

function buildRichPlayerMention(config, user, member, profile, team) {
  const resolvedTeam = team || getUserTeamFromMember(member, config, 'player');
  const teamEmoji = config.teams?.[resolvedTeam]?.emoji || '🔹';
  const captainEmoji = getCaptainSuffix(config, resolvedTeam, member);
  const shirt = profile?.shirtNumber ? `#${profile.shirtNumber}` : '#--';
  const baseName = getPlayerNameForUi(user, member, profile);
  return `${teamEmoji}${captainEmoji ? ` ${captainEmoji}` : ''} ${shirt} ${baseName}`.trim();
}

function buildAbsenceTicketChannelName(config, event, profile, member, user) {
  const teamEmoji = config.teams?.[event.team]?.emoji || 'team';
  const captainEmoji = getCaptainSuffix(config, event.team, member);
  const displayName = getPlayerNameForUi(user, member, profile);
  const eventDateLabel = getCompactDateLabel(event.date);
  return sanitizeChannelName(`${teamEmoji}${captainEmoji}-${displayName}-${eventDateLabel}-${event.title}`);
}

function createPlayerOptions(guild = null, config = loadConfig()) {
  if (!guild) return [];
  const playerIds = new Set();
  for (const teamKey of Object.keys(config.teams || {})) {
    const playerRoleId = config.roles?.[teamKey]?.player;
    const role = playerRoleId ? guild.roles.cache.get(playerRoleId) : null;
    if (!role) continue;
    for (const memberId of role.members.keys()) playerIds.add(memberId);
  }

  return Array.from(playerIds)
    .map((userId) => {
      const member = guild.members.cache.get(userId);
      const playingTeams = Object.keys(config.teams || {}).filter((teamKey) => {
        const roleId = config.roles?.[teamKey]?.player;
        return roleId && roleId !== 'ROLE_ID' && member?.roles?.cache?.has(roleId);
      });
      const teamLabel = playingTeams.length
        ? playingTeams.map((team) => getTeamMeta(config, team).label).join(', ')
        : 'Does not play for a team';
      return {
        label: (member?.displayName || member?.user?.username || userId).slice(0, 100),
        value: userId,
        description: `Teams: ${teamLabel}`.slice(0, 100)
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

function createPlayerManagementRows(mode = 'player', guild = null, page = 0) {
  if (!guild) {
    return [new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId('admin_player_select')
        .setPlaceholder('Select a player to manage')
        .setMinValues(1)
        .setMaxValues(1)
    )];
  }

  const config = loadConfig();
  const allOptions = createPlayerOptions(guild, config);
  const perPage = 25;
  const totalPages = Math.max(1, Math.ceil(allOptions.length / perPage));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const options = allOptions.slice(safePage * perPage, safePage * perPage + perPage);
  if (!options.length) options.push({ label: 'No players found', value: 'none', description: 'Assign player roles first' });

  const rows = [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_player_pick')
      .setPlaceholder(`Select a player to manage (Page ${safePage + 1}/${totalPages})`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options)
  )];

  if (totalPages > 1) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`admin_player_page:${safePage - 1}`).setLabel('<').setStyle(ButtonStyle.Secondary).setDisabled(safePage <= 0),
      new ButtonBuilder().setCustomId(`admin_player_page:${safePage + 1}`).setLabel('>').setStyle(ButtonStyle.Secondary).setDisabled(safePage >= totalPages - 1)
    ));
  }

  return rows;
}

function createCoachManagementRow(config, guild) {
  if (!guild) {
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('admin_coach_pick')
        .setPlaceholder('Select a coach to manage')
        .addOptions([{ label: 'No coaches found', value: 'none', description: 'Assign coach roles first' }])
    );
  }
  const coachIds = new Set();
  for (const teamKey of Object.keys(config.teams || {})) {
    const coachRoleId = config.roles?.[teamKey]?.coach;
    const role = coachRoleId ? guild.roles.cache.get(coachRoleId) : null;
    if (!role) continue;
    for (const memberId of role.members.keys()) coachIds.add(memberId);
  }

  const options = Array.from(coachIds).slice(0, 25).map((userId) => {
    const member = guild.members.cache.get(userId);
    const profile = getPlayerProfile(userId) || {};
    const coachedTeams = Object.keys(config.teams || {}).filter((teamKey) => {
      const roleId = config.roles?.[teamKey]?.coach;
      return roleId && roleId !== 'ROLE_ID' && member?.roles?.cache?.has(roleId);
    });
    const primaryTitle = coachedTeams.length ? getCoachPositionLabel(getCoachPositionForTeam(profile, coachedTeams[0])) : 'Coach';
    return {
      label: `${primaryTitle} ${member?.displayName || member?.user?.username || userId}`.slice(0, 100),
      value: userId,
      description: `Manage coach ${member?.user?.tag || userId}`.slice(0, 100)
    };
  });

  if (!options.length) {
    options.push({ label: 'No coaches found', value: 'none', description: 'Assign coach roles first' });
  }

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_coach_pick')
      .setPlaceholder('Select a coach to manage')
      .addOptions(options)
  );
}

function createPlayerProfileActionRow(userId, mode = 'player') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`admin_player_action:set_name:${userId}:${mode}`).setLabel('🪪 Name').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`admin_player_action:set_nickname:${userId}:${mode}`).setLabel('🤿 Nickname').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`admin_player_action:set_face:${userId}:${mode}`).setLabel('📸 Photo').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`admin_player_action:set_shirt:${userId}:${mode}`).setLabel('👕 Shirt by Team').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`admin_player_action:set_notes:${userId}:${mode}`).setLabel('🗒️ Notes').setStyle(ButtonStyle.Secondary)
  );
}

function createPlayerProfileActionRow2(userId, mode = 'player') {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`admin_player_action:set_teams:${userId}:${mode}`).setLabel('🧩 Teams').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_player_action:set_gender:${userId}:${mode}`).setLabel('⚧️ Gender').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_player_action:assign_roles:${userId}:${mode}`).setLabel('🎭 Assign Roles').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_player_view_attendance:${userId}:${mode}`).setLabel('📈 Attendance').setStyle(ButtonStyle.Success)
  );
  if (mode === 'coach') {
    row.addComponents(
      new ButtonBuilder().setCustomId(`admin_player_action:set_coach_positions:${userId}:${mode}`).setLabel('🎓 Coaching Title').setStyle(ButtonStyle.Primary)
    );
  }
  return row;
}

function getProfileNotes(profile = {}) {
  return Array.isArray(profile.notesLog) ? profile.notesLog : [];
}

function createPlayerNotesActionRows(userId, mode = 'player', isAdmin = false, profile = {}) {
  const notes = getProfileNotes(profile);
  const visibleNotes = notes.filter((note) => !note.hidden);
  const hiddenNotes = notes.filter((note) => note.hidden);
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`admin_player_note_add:${userId}:${mode}`).setLabel('➕ Add Note').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`admin_player_back_to_profile:${userId}:${mode}`).setLabel('⬅️ Back to Player').setStyle(ButtonStyle.Secondary)
    )
  ];

  if (isAdmin && visibleNotes.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`admin_player_note_toggle:${userId}:${mode}:hide`)
        .setPlaceholder('Hide a visible note')
        .addOptions(visibleNotes.slice(0, 25).map((note) => ({
          label: `${new Date(note.createdAt).toLocaleDateString()} · ${(note.authorTag || note.authorId || 'unknown')}`.slice(0, 100),
          value: note.id,
          description: String(note.text || '').slice(0, 100)
        })))
    ));
  }

  if (isAdmin && hiddenNotes.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`admin_player_note_toggle:${userId}:${mode}:unhide`)
        .setPlaceholder('Restore a hidden note')
        .addOptions(hiddenNotes.slice(0, 25).map((note) => ({
          label: `${new Date(note.createdAt).toLocaleDateString()} · ${(note.authorTag || note.authorId || 'unknown')}`.slice(0, 100),
          value: note.id,
          description: String(note.text || '').slice(0, 100)
        })))
    ));
  }

  return rows;
}

function createPlayerTeamSelectRow(config, userId, mode = 'player') {
  const options = Object.entries(config.teams || {}).map(([team, meta]) => ({
    label: `${meta.emoji || '🔹'} ${meta.label || team}`.slice(0, 100),
    value: team
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`admin_player_set_teams:${userId}:${mode}`)
      .setPlaceholder(mode === 'coach' ? 'Select teams this coach manages' : 'Select teams for this player')
      .setMinValues(0)
      .setMaxValues(Math.min(options.length, 25))
      .addOptions(options.slice(0, 25))
  );
}

function createPlayerRoleAssignRow(userId, mode = 'player') {
  return new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(`admin_player_assign_roles:${userId}:${mode}`)
      .setPlaceholder('Select role(s) to toggle (add/remove)')
      .setMinValues(1)
      .setMaxValues(25)
  );
}

function createGenderButtonsRow(userId, mode = 'player') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`admin_player_set_gender:${userId}:${mode}:male`).setLabel('Male').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`admin_player_set_gender:${userId}:${mode}:female`).setLabel('Female').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`admin_player_set_gender:${userId}:${mode}:clear`).setLabel('Not set').setStyle(ButtonStyle.Secondary)
  );
}

function createAttendanceOnlyRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`admin_player_view_attendance:${userId}:player`)
      .setLabel('📈 Attendance')
      .setStyle(ButtonStyle.Success)
  );
}

function getMemberTeamAssignments(member, config) {
  const playingTeams = Object.keys(config.teams || {}).filter((teamKey) => {
    const roleId = config.roles?.[teamKey]?.player;
    return roleId && roleId !== 'ROLE_ID' && member?.roles?.cache?.has(roleId);
  });
  const coachingTeams = Object.keys(config.teams || {}).filter((teamKey) => {
    const roleId = config.roles?.[teamKey]?.coach;
    return roleId && roleId !== 'ROLE_ID' && member?.roles?.cache?.has(roleId);
  });
  return { playingTeams, coachingTeams };
}

function getShirtForTeam(profile = {}, team = '') {
  if (profile.shirtNumbers && typeof profile.shirtNumbers === 'object') {
    return profile.shirtNumbers[team] || '';
  }
  return profile.shirtNumber || '';
}

function getCoachPositionForTeam(profile = {}, team = '') {
  return profile.coachPositions?.[team] || '';
}

function getCoachPositionLabel(value = '') {
  if (value === 'head_coach') return 'Head Coach';
  if (value === 'assistant_coach') return 'Assistant Coach';
  if (value === 'goalkeeping_coach') return 'Goal Keeping Coach';
  return 'Coach';
}

async function handleAdminPlayerAction(interaction, selectedAction, userId, mode = 'player') {
  const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
  const targetUser = targetMember?.user || await interaction.client.users.fetch(userId).catch(() => null);
  const latestConfig = loadConfig();
  const existingProfile = getPlayerProfile(userId) || {};
  const inferredPlayerTeams = Object.keys(latestConfig.roles || {}).filter((teamKey) => {
    const roleId = latestConfig.roles?.[teamKey]?.player;
    return roleId && roleId !== 'ROLE_ID' && targetMember?.roles?.cache?.has(roleId);
  });
  const inferredCoachTeams = Object.keys(latestConfig.roles || {}).filter((teamKey) => {
    const roleId = latestConfig.roles?.[teamKey]?.coach;
    return roleId && roleId !== 'ROLE_ID' && targetMember?.roles?.cache?.has(roleId);
  });

  const mergedProfile = {
    ...existingProfile,
    userId,
    teams: Array.from(new Set([...(existingProfile.teams || []), ...inferredPlayerTeams])),
    coachTeams: Array.from(new Set([...(existingProfile.coachTeams || []), ...inferredCoachTeams])),
    roles: existingProfile.roles || (targetMember ? Array.from(targetMember.roles.cache.keys()).filter((id) => id !== interaction.guild.id) : [])
  };
  upsertPlayerProfile(userId, mergedProfile);

  if (selectedAction === 'set_teams') {
    await interaction.update({
      content: mode === 'coach' ? 'Select managed teams for this coach.' : 'Select profile teams for this player.',
      embeds: [],
      components: [createPlayerTeamSelectRow(loadConfig(), userId, mode), createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')]
    });
    return true;
  }

  if (selectedAction === 'assign_roles') {
    await interaction.update({
      content: 'Select role(s) to toggle. Existing selected role(s) will be removed on Discord; missing role(s) will be added.',
      embeds: [],
      components: [createPlayerRoleAssignRow(userId, mode), createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')]
    });
    return true;
  }

  if (selectedAction === 'set_gender') {
    await interaction.update({
      content: 'Set gender using the buttons below.',
      embeds: [],
      components: [createGenderButtonsRow(userId, mode), createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')]
    });
    return true;
  }

  if (selectedAction === 'set_shirt') {
    const teams = mergedProfile.teams?.length ? mergedProfile.teams : inferredPlayerTeams;
    if (!teams.length) {
      await interaction.update({
        content: 'This player has no playing teams. Assign teams first.',
        embeds: [],
        components: [createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')]
      });
      return true;
    }
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`admin_player_shirt_team:${userId}:${mode}`)
        .setPlaceholder('Pick team to set shirt number')
        .addOptions(teams.slice(0, 25).map((team) => ({
          label: `${getTeamMeta(latestConfig, team).label}`.slice(0, 100),
          value: team,
          description: `Current #${getShirtForTeam(mergedProfile, team) || '--'}`.slice(0, 100)
        })))
    );
    await interaction.update({ content: 'Select the team for shirt number update.', embeds: [], components: [row, createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')] });
    return true;
  }

  if (selectedAction === 'set_coach_positions') {
    const coachTeams = mergedProfile.coachTeams?.length ? mergedProfile.coachTeams : inferredCoachTeams;
    if (!coachTeams.length) {
      await interaction.update({
        content: 'This user is not coaching any teams yet.',
        embeds: [],
        components: [createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')]
      });
      return true;
    }
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`admin_coach_position_team:${userId}:${mode}`)
        .setPlaceholder('Pick team to set coach position')
        .addOptions(coachTeams.slice(0, 25).map((team) => ({
          label: `${getTeamMeta(latestConfig, team).label}`.slice(0, 100),
          value: team,
          description: `${getCoachPositionForTeam(mergedProfile, team) || 'Not set'}`.slice(0, 100)
        })))
    );
    await interaction.update({ content: 'Choose the coached team to set position.', embeds: [], components: [row, createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')] });
    return true;
  }

  if (selectedAction === 'set_notes') {
    const isAdminViewer = hasAdminAccess(interaction.member, latestConfig);
    const visibleNotes = getProfileNotes(mergedProfile).filter((note) => !note.hidden);
    await interaction.update({
      content: [
        `Notes for <@${userId}> (${mode} profile):`,
        visibleNotes.length
          ? visibleNotes.map((note, idx) => `${idx + 1}. [${new Date(note.createdAt).toISOString().slice(0, 10)}] ${note.authorTag || note.authorId || 'unknown'} — ${note.text}`).join('\n')
          : '*No visible notes yet.*',
        isAdminViewer ? '' : '_Hidden notes are admin-only._'
      ].join('\n'),
      embeds: [],
      components: createPlayerNotesActionRows(userId, mode, isAdminViewer, mergedProfile)
    });
    return true;
  }

  const modalTitles = {
    set_name: mode === 'coach' ? 'Set Coach Real Name' : 'Set Player Real Name',
    set_nickname: mode === 'coach' ? 'Set Coach Nickname' : 'Set Player Nickname',
    set_face: 'Set Player Face URL (.png, .webp, or .jpg)',
    set_shirt: 'Set Player Shirt Number',
    set_gender: 'Set Player Gender (male/female only)'
  };
  const fieldByAction = {
    set_name: { id: 'custom_name', label: 'Real name', value: mergedProfile.customName || '' },
    set_nickname: { id: 'nickname', label: 'Nickname', value: mergedProfile.nickName || '' },
    set_face: { id: 'face_image_url', label: 'Face image URL', value: mergedProfile.faceImageUrl || mergedProfile.facePngUrl || '' },
    set_shirt: { id: 'shirt_number', label: 'Shirt number', value: mergedProfile.shirtNumber || '' },
    set_gender: { id: 'gender', label: 'Gender (male/female)', value: mergedProfile.gender || '' }
  };
  const field = fieldByAction[selectedAction];
  if (!field) {
    await interaction.reply({ content: 'That profile action is no longer supported.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }

  const modal = new ModalBuilder()
    .setCustomId(`admin_player_profile_modal:${selectedAction}:${userId}:${mode}`)
    .setTitle(modalTitles[selectedAction] || 'Update Player Profile');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(field.id)
        .setLabel(field.label)
        .setStyle(TextInputStyle.Short)
        .setRequired(selectedAction !== 'set_face')
        .setValue(field.value)
        .setMaxLength(200)
    )
  );

  await interaction.showModal(modal);
  return true;
}

function buildPlayerProfileSummary(config, guild, user, member, profile = {}, mode = 'player') {
  const discordName = user?.tag || user?.username || profile.userId || 'Unknown';
  const realName = profile.customName || member?.displayName || user?.globalName || user?.username || 'not set';
  const nickname = profile.nickName || '';
  const { playingTeams, coachingTeams } = getMemberTeamAssignments(member, config);
  const teamLabels = playingTeams.length
    ? playingTeams.map((team) => {
      const shirt = getShirtForTeam(profile, team);
      return `${getTeamMeta(config, team).label}${shirt ? ` (#${shirt})` : ''}`;
    }).join(', ')
    : 'Does not play for a team';
  const coachTeamLabels = coachingTeams.map((team) => `${getTeamMeta(config, team).label} (${getCoachPositionLabel(getCoachPositionForTeam(profile, team))})`).join(', ');
  const captainTeams = playingTeams.filter((team) => {
    const captainRoleId = config.teams?.[team]?.captainRoleId;
    return captainRoleId && member?.roles?.cache?.has(captainRoleId);
  });
  const captainSummary = captainTeams.length
    ? `Captain of ${captainTeams.map((team) => getTeamMeta(config, team).label).join(', ')}`
    : 'Not captain';
  const roles = (profile.roles || []).map((roleId) => formatConfigRef(guild, 'role', roleId)).join(', ') || 'not set';
  const joined = profile.joinedDiscordAt || (member?.joinedAt ? member.joinedAt.toISOString().slice(0, 10) : 'unknown');
  const faceImageUrl = profile.faceImageUrl || profile.facePngUrl || '';
  const hasImage = Boolean(faceImageUrl);
  const canRenderImage = /^https?:\/\/\S+\.(png|webp|jpe?g)(?:\?\S*)?$/i.test(faceImageUrl);
  const faceImageLabel = !hasImage ? 'No image set' : canRenderImage ? 'Image shown below' : 'Error cannot view set image';
  const notes = getProfileNotes(profile);
  const visibleNotes = notes.filter((note) => !note.hidden);
  const hiddenCount = notes.length - visibleNotes.length;
  const notesPreview = visibleNotes.length
    ? visibleNotes
      .slice(-5)
      .map((note) => `  - ${new Date(note.createdAt).toISOString().slice(0, 10)} · ${note.authorTag || note.authorId || 'unknown'}: ${note.text}`)
      .join('\n')
    : '  - none';

  const managerLabel = mode === 'coach' ? 'Managing manager (coach profile)' : 'Managing player';
  const attendanceSummary = buildAttendanceStatsMessage(user?.id || profile.userId, config).split('\n').slice(1).join('\n');
  const absenceLines = buildDetailedAttendanceMessage(user?.id || profile.userId, config, 'all')
    .split('\n')
    .filter((line) => line.includes('🔴'))
    .slice(-5);

  return [
    `${managerLabel}: <@${user?.id || profile.userId}>`,
    '',
    `🖼️ Face image: ${faceImageLabel}`,
    `🪪 Name: ${realName}`,
    '',
    '**Profile**',
    `• Discord: <@${user?.id || profile.userId}>`,
    `• Real name: ${realName}`,
    `• Gender: ${profile.gender || 'not set'}`,
    `• Nickname: ${nickname || 'not set'}`,
    `• Face image: ${faceImageLabel}`,
    `• Joined discord server: ${joined}`,
    '',
    '**Teams**',
    `• Teams playing for: ${teamLabels}`,
    `• Captain: ${captainSummary}`,
    '',
    ...(coachTeamLabels ? ['**Coaching**', `• Teams coaching: ${coachTeamLabels}`, ''] : []),
    '**Notes**',
    visibleNotes.length ? notesPreview : 'none',
    '',
    '**Attendance summary**',
    attendanceSummary,
    absenceLines.length ? `• Not attended:\n${absenceLines.join('\n')}` : '• Not attended: none',
    '',
    `• Roles: ${roles}`
  ].join('\n');
}

function buildPlayerProfileEmbeds(user, profile = {}, mode = 'player') {
  const faceImageUrl = profile.faceImageUrl || profile.facePngUrl || '';
  const canRenderImage = /^https?:\/\/\S+\.(png|webp|jpe?g)(?:\?\S*)?$/i.test(faceImageUrl);
  if (!canRenderImage) return [];
  return [new EmbedBuilder()
    .setTitle(mode === 'coach' ? `Coach Face — ${user?.username || profile.userId}` : `Player Face — ${user?.username || profile.userId}`)
    .setImage(faceImageUrl)
    .setColor(0x3498db)];
}

function buildPlayerProfileView(config, guild, user, member, profile = {}, mode = 'player') {
  return {
    content: buildPlayerProfileSummary(config, guild, user, member, profile, mode),
    embeds: buildPlayerProfileEmbeds(user, profile, mode)
  };
}

function buildAttendanceStatsForUser(userId, config) {
  const db = loadDb();
  const events = Object.values(db.events || {});
  const stats = {
    practice: { attended: 0, missed: 0 },
    match: { attended: 0, missed: 0 },
    other: { attended: 0, missed: 0 }
  };

  for (const event of events) {
    const response = event.responses?.[userId];
    if (!response) continue;
    const eventType = determineEventType(event, config);
    if (response.status === 'yes') {
      stats[eventType].attended += 1;
    } else if (['pending_no', 'confirmed_no'].includes(response.status)) {
      stats[eventType].missed += 1;
    }
  }

  return stats;
}

function buildAttendanceStatsMessage(userId, config) {
  const stats = buildAttendanceStatsForUser(userId, config);
  return [
    `Attendance stats for <@${userId}>`,
    `• ${eventTypeLabel('practice')}: ✅ ${stats.practice.attended} | 🔴 ${stats.practice.missed}`,
    `• ${eventTypeLabel('match')}: ✅ ${stats.match.attended} | 🔴 ${stats.match.missed}`,
    `• ${eventTypeLabel('other')}: ✅ ${stats.other.attended} | 🔴 ${stats.other.missed}`
  ].join('\n');
}

function buildDetailedAttendanceMessage(userId, config, type = 'all') {
  const db = loadDb();
  const events = Object.entries(db.events || {})
    .map(([id, event]) => ({ id, ...event }))
    .filter((event) => {
      const eventType = determineEventType(event, config);
      return type === 'all' || eventType === type;
    })
    .filter((event) => event.responses?.[userId])
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (!events.length) return `No attendance entries found for <@${userId}> in **${eventTypeLabel(type)}**.`;

  const lines = [`Attendance history for <@${userId}> — **${eventTypeLabel(type)}**`, ''];
  let activeMonth = '';
  for (const event of events) {
    const monthLabel = new Date(event.date).toLocaleString('en-US', { month: 'long', year: 'numeric' });
    if (monthLabel !== activeMonth) {
      activeMonth = monthLabel;
      lines.push(`__${monthLabel}__`);
    }
    const response = event.responses[userId];
    const attended = response.status === 'yes';
    const responder = getResponderMeta(response);
    const reason = !attended ? (response.reason || 'No reason provided') : '';
    lines.push(`• ${new Date(event.date).toLocaleDateString()} — ${event.title} — ${responder.emoji} ${responder.label} — ${attended ? '✅ Attending' : `🔴 Not attending (${reason})`}`);
  }

  return lines.join('\n');
}

function createAttendanceTypeRow(userId, mode = 'player') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`admin_player_attendance_type:${userId}:${mode}:practice`).setLabel('🏃 Practices').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_player_attendance_type:${userId}:${mode}:match`).setLabel('⚽ Matches').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_player_attendance_type:${userId}:${mode}:other`).setLabel('📌 Other').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_player_attendance_type:${userId}:${mode}:all`).setLabel('📚 All').setStyle(ButtonStyle.Primary)
  );
}

function createAttendanceResultRows(userId, mode = 'player', type = 'all') {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`admin_player_attendance_export:${userId}:${mode}:${type}`).setLabel('📤 Export Attendance').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`admin_player_absence_reasons:${userId}:${mode}:${type}`).setLabel('🧾 Absence Reasons').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`admin_player_absence_logs:${userId}:${mode}`).setLabel('📜 Ticket Logs').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`admin_player_back_to_profile:${userId}:${mode}`).setLabel('⬅️ Back to Player').setStyle(ButtonStyle.Secondary)
    ),
    createAttendanceTypeRow(userId, mode)
  ];
}

function createAbsenceTicketDecisionRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('absence_ticket_confirm')
      .setLabel('✅ Confirm Not Attending')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('absence_ticket_decline')
      .setLabel('↩️ Decline (Ask to Attend)')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('absence_ticket_player_attend')
      .setLabel('🟢 I can attend')
      .setStyle(ButtonStyle.Primary)
  );
}

async function closeAbsenceTicketChannel(channel, reason = 'Absence ticket resolved') {
  if (!channel) return;
  const db = loadDb();
  const ticket = db.absenceTickets?.[channel.id];
  const event = ticket ? db.events?.[ticket.eventId] : null;
  try {
    if (channel.isTextBased()) {
      const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (fetched) {
        const chatLog = Array.from(fetched.values())
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
          .map((msg) => {
            const iso = new Date(msg.createdTimestamp).toISOString();
            const date = new Date(msg.createdTimestamp);
            return {
              ts: iso,
              day: date.toISOString().slice(0, 10),
              time: date.toISOString().slice(11, 16),
              userId: msg.author?.id || '',
              name: getPlayerDisplayName(msg.author?.id || '', loadConfig()) || msg.member?.displayName || msg.author?.username || 'unknown',
              message: msg.content || '(no text)'
            };
          });
        if (chatLog.length) {
          setAbsenceTicket(channel.id, { chatLog });
        }
      }
    }
  } catch (error) {
    await Promise.resolve();
  }

  if (ticket) {
    const notices = [ticket.staffNotification, ticket.adminNotification].filter(Boolean);
    for (const notice of notices) {
      const noticeChannel = await channel.guild.channels.fetch(notice.channelId).catch(() => null);
      if (!noticeChannel?.isTextBased()) continue;
      const message = await noticeChannel.messages.fetch(notice.messageId).catch(() => null);
      if (!message) continue;
      const mode = notice.mode === 'admin' ? 'admin' : 'coach';
      await message.edit({
        content: formatAbsenceNotification(ticket, event, 'closed'),
        components: [createAbsenceNotificationRow(channel.id, ticket.playerId, mode, true)]
      }).catch(() => null);
    }
  }

  if (channel.deletable) {
    await channel.delete(reason).catch(() => null);
  }
}

function summarizeAttendance(event, db, guild, teamRolesMap) {
  if (!event.team || !teamRolesMap[event.team]?.player) return 'Attendance: n/a';

  const roleId = teamRolesMap[event.team].player;
  const role = guild.roles.cache.get(roleId);
  const totalPlayers = role ? role.members.size : 0;
  const responses = db.events[event.id]?.responses || {};
  const values = Object.values(responses);

  const yes = values.filter((response) => response.status === 'yes').length;
  const no = values.filter((response) => response.status === 'pending_no' || response.status === 'confirmed_no').length;
  const noResponse = Math.max(totalPlayers - yes - no, 0);

  return `✅ ${yes} | 🔴 ${no} | ❓ ${noResponse}`;
}

function formatTeamLabel(event, config) {
  if (!event.team) return '❔ Unknown Team';
  const { emoji, label } = getTeamMeta(config, event.team);
  return `${emoji} ${label}`;
}

async function triggerGoogleSync(context) {
  const latestConfig = context.getConfig();
  if (!latestConfig.googleSync?.enabled) return;

  try {
    await syncAllToSheet(latestConfig, loadDb());
    updateConfig('googleSync.lastSyncedAt', new Date().toISOString());
  } catch (error) {
    await context.sendLog(`⚠️ Google Sheets sync failed after attendance update: ${error.message}`);
  }
}

async function logAdminUiAction(interaction, command, subcommand = '', options = {}) {
  try {
    const config = loadConfig();
    if (!config.googleSync?.enabled) return;

    await appendCommandLogRow(config, {
      source: 'admin_ui',
      command,
      subcommand,
      options: JSON.stringify(options || {}),
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      username: interaction.user.tag
    });
  } catch (error) {
    await interaction.followUp({ content: `⚠️ Could not write command log row: ${error.message}`, flags: MessageFlags.Ephemeral }).catch(() => null);
  }
}

async function syncConfigSnapshotIfEnabled() {
  const latestConfig = loadConfig();
  if (!latestConfig.googleSync?.enabled) return;
  await syncConfigOnlyToSheet(latestConfig);
}

async function handlePanelGoogleSync(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const latestConfig = loadConfig();
  updateConfig('googleSync.enabled', true);
  const db = loadDb();

  try {
    const result = await syncAllToSheet({ ...latestConfig, googleSync: { ...latestConfig.googleSync, enabled: true } }, db);
    if (!result.ok) {
      await interaction.editReply('Could not sync because spreadsheet ID is not configured.');
      return;
    }
    updateConfig('googleSync.lastSyncedAt', new Date().toISOString());

    await interaction.editReply(`✅ Synced fixtures, attendance, command log, and config to Google Sheets (\`${result.spreadsheetId}\`).`);
  } catch (error) {
    await interaction.editReply(`❌ Google sync failed: ${error.message}`);
  }
}

module.exports = {
  name: 'interactionCreate',

  async execute(interaction, context) {
    const config = context.getConfig();
    const teamRolesMap = config.roles;

    const denyAdminAccess = async () => {
      await interaction.reply({ content: adminAccessMessage(config), flags: MessageFlags.Ephemeral });
    };

    if (interaction.isButton()) {
      if (interaction.customId === 'admin_back_to_panel') {
        const latestConfig = loadConfig();
        await interaction.update({
          content: '',
          embeds: [adminCommand.buildAdminPanelEmbed(latestConfig)],
          components: withOptionalRow([createAdminQuickActionRow(), createAdminQuickActionExtraRow()])
        });
        return;
      }
      if (interaction.customId === 'admin_back_team_management') {
        const latestConfig = loadConfig();
        await interaction.update({
          content: getTeamManagementSummary(),
          embeds: [],
          components: [...createTeamButtonsRows(latestConfig), createTeamManagementRow()]
        });
        return;
      }
      if (interaction.customId === 'admin_back_club_management') {
        await interaction.update({
          content: getClubManagementSummary(),
          embeds: [],
          components: [createClubManagementRow(), createClubManagementRow2()]
        });
        return;
      }
      if (interaction.customId === 'admin_back_google_tools') {
        await interaction.update({
          content: getGoogleToolsSummary(loadConfig()),
          embeds: [],
          components: [createGoogleToolsRow(), createGoogleToolsRow2()]
        });
        return;
      }
      if (interaction.customId === 'admin_back_player_management') {
        await interaction.guild?.members.fetch().catch(() => null);
        await interaction.update({
          content: getPlayerManagementSummary(),
          embeds: [],
          components: [...createPlayerManagementRows('player', interaction.guild, 0), createAdminBackButtonRow()]
        });
        return;
      }
      if (interaction.customId === 'admin_sheet_backup_create') {
        const modal = new ModalBuilder().setCustomId('admin_sheet_backup_create_modal').setTitle('Save Sheet Backup');
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('backup_name').setLabel('Backup name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('backup_slot').setLabel('Backup slot (1-5)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(1).setValue('1')
          )
        );
        await interaction.showModal(modal);
        return;
      }
      if (interaction.customId === 'admin_sheet_backup_restore') {
        const backups = (await loadSheetBackups(loadConfig()).catch(() => [])).sort((a, b) => a.slot - b.slot);
        if (!backups.length) {
          await interaction.update({ content: 'No backups available yet.', embeds: [], components: [createBackButtonRow('admin_back_club_management')] });
          return;
        }
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('admin_sheet_backup_restore_pick')
            .setPlaceholder('Choose backup to restore')
            .addOptions(backups.map((entry) => ({
              label: `Slot ${entry.slot} • ${entry.name || `Backup ${entry.slot}`}`.slice(0, 100),
              value: String(entry.slot),
              description: (entry.createdAt || 'unknown').slice(0, 100)
            })))
        );
        await interaction.update({ content: 'Pick backup slot to restore from Backups sheet.', embeds: [], components: [row, createBackButtonRow('admin_back_club_management')] });
        return;
      }
      if (interaction.customId.startsWith('admin_action:')) {
        const action = interaction.customId.split(':')[1];
        if (action === 'team_management') {
          const latestConfig = loadConfig();
          await interaction.update({
            content: getTeamManagementSummary(),
            embeds: [],
            components: [...createTeamButtonsRows(latestConfig), createTeamManagementRow()]
          });
          return;
        }
        if (action === 'club_management') {
          await interaction.update({ content: getClubManagementSummary(), embeds: [], components: [createClubManagementRow(), createClubManagementRow2()] });
          return;
        }
        if (action === 'player_management') {
          await interaction.guild?.members.fetch().catch(() => null);
          await interaction.update({
            content: getPlayerManagementSummary(),
            embeds: [],
            components: [...createPlayerManagementRows('player', interaction.guild, 0), createAdminBackButtonRow()]
          });
          return;
        }
        if (action === 'coach_management') {
          await interaction.update({ content: getCoachManagementSummary(), embeds: [], components: [createCoachManagementRow(loadConfig(), interaction.guild), createAdminBackButtonRow()] });
          return;
        }
        if (action === 'club_report') {
          await logAdminUiAction(interaction, 'admin', 'club-report');
          await adminCommand.handleClubReport(interaction);
          return;
        }
      }
      if (interaction.customId.startsWith('admin_club_action:')) {
        const action = interaction.customId.split(':')[1];
        if (action === 'google') {
          await interaction.update({ content: getGoogleToolsSummary(loadConfig()), embeds: [], components: [createGoogleToolsRow(), createGoogleToolsRow2()] });
          return;
        }
        if (action === 'set_admin_chat') {
          const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder().setCustomId('admin_set_channel:channels.admin:global').setPlaceholder('Choose Admin Chat channel').setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1)
          );
          await interaction.update({ content: 'Select the Admin chat channel. Bot errors + interaction failures are posted there.', embeds: [], components: [row, createBackButtonRow('admin_back_club_management')] });
          return;
        }
        if (action === 'set_bot_commands_chat') {
          const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder().setCustomId('admin_set_channel:channels.botCommands:global').setPlaceholder('Choose Bot Commands channel').setChannelTypes(ChannelType.GuildText).setMinValues(1).setMaxValues(1)
          );
          await interaction.update({ content: 'Select the channel where /player and /coach commands must be used.', embeds: [], components: [row, createBackButtonRow('admin_back_club_management')] });
          return;
        }
        if (action === 'event_type_rules') {
          const rules = getEventTypeConfig(loadConfig());
          await interaction.update({
            content: [
              '🧭 **Event Type Rules**',
              'Control how fixtures are classified as practice/match/other.',
              '',
              'Buttons in this menu:',
              '• Auto Detect toggle — switch title-based auto classification ON/OFF.',
              '• Practice/Match/Other Exact Names — save exact title matches per type.',
              '• Manual Event Type — change a specific event type manually.',
              '',
              `• Auto Detect: **${rules.autoDetect ? 'ON' : 'OFF'}**`,
              `• Practice Exact Names: ${rules.practiceExactNames.join(', ') || 'none'}`,
              `• Match Exact Names: ${rules.matchExactNames.join(', ') || 'none'}`,
              `• Other Exact Names: ${rules.otherExactNames.join(', ') || 'none'}`
            ].join('\n'),
            embeds: [],
            components: [createEventTypeRulesRow(loadConfig()), createEventTypeRulesRow2()]
          });
          return;
        }
        if (action === 'backups') {
          const backups = await loadSheetBackups(loadConfig()).catch(() => []);
          const lines = backups.length
            ? backups
              .sort((a, b) => a.slot - b.slot)
              .map((entry) => `• Slot ${entry.slot}: **${entry.name || `Backup ${entry.slot}`}** (${entry.createdAt || 'unknown'})`)
            : ['No sheet backups saved yet.'];
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admin_sheet_backup_create').setLabel('➕ Save Backup').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('admin_sheet_backup_restore').setLabel('♻️ Restore Backup').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('admin_back_club_management').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
          );
          await interaction.update({ content: `💾 Sheet Backups (max 5 slots)\nStores every non-Backups tab and every row/cell.\n${lines.join('\n')}`, embeds: [], components: [row] });
          return;
        }
      }
      if (interaction.customId.startsWith('admin_google_action:')) {
        const action = interaction.customId.split(':')[1];
        if (action === 'set_calendar_id') {
          const modal = new ModalBuilder().setCustomId('admin_set_calendar_modal').setTitle('Set Google Calendar ID');
          const calendarIdInput = new TextInputBuilder().setCustomId('calendar_id').setLabel('Google Calendar ID (email-like)').setStyle(TextInputStyle.Short).setRequired(true).setValue(config.bot.calendarId || '').setMaxLength(150);
          modal.addComponents(new ActionRowBuilder().addComponents(calendarIdInput));
          await interaction.showModal(modal);
          return;
        }
        if (action === 'sync_google') {
          await logAdminUiAction(interaction, 'admin-config', 'sync-google');
          await handlePanelGoogleSync(interaction);
          return;
        }
        if (action === 'open_google_sheet') {
          const latestConfig = context.getConfig();
          const sheetUrl = adminCommand.getSpreadsheetViewUrl(latestConfig);
          await logAdminUiAction(interaction, 'admin', 'open-google-sheet');
          await interaction.update({ content: sheetUrl ? `Open Google Sheet: ${sheetUrl}` : 'Google spreadsheet is not configured yet. Set it first in Club Management > Google.', embeds: [], components: [createGoogleToolsRow(), createGoogleToolsRow2()] });
          return;
        }
        if (action === 'view_google_events') {
          await interaction.update({ content: 'Choose a team to view fixtures, or choose **All Teams**.', embeds: [], components: withOptionalRow([createEventScopePickerRow(loadConfig()), createBackButtonRow('admin_back_google_tools')]) });
          return;
        }
        if (action === 'view_event_locations') {
          const db = loadDb();
          const grouped = buildLocationGroupsFromEvents(Object.values(db.events || {}), config);
          if (!grouped.length) {
            await interaction.update({
              content: 'No event addresses found yet. Sync calendar fixtures first.',
              embeds: [],
              components: [createGoogleToolsRow(), createGoogleToolsRow2()]
            });
            return;
          }

          const lines = grouped.map((entry) => {
            const label = `(${eventTypeLabel(entry.eventType)})`;
            return `• ${label} [${entry.location}](${getMapsLink(entry.location)}) — ${entry.count} event(s)`;
          });

          const chunks = chunkLines(lines, 15);
          const embeds = chunks.map((chunk, idx) => new EmbedBuilder()
            .setTitle(`Event Addresses (${grouped.length})`)
            .setDescription(chunk.join('\n\n'))
            .setColor(0x3498db)
            .setFooter({ text: `Page ${idx + 1} of ${chunks.length}` }));

          await interaction.update({
            content: '📍 Grouped event addresses:',
            embeds: [embeds[0]],
            components: [createGoogleToolsRow(), createGoogleToolsRow2()]
          });

          for (let i = 1; i < embeds.length; i += 1) {
            await interaction.followUp({ embeds: [embeds[i]], flags: MessageFlags.Ephemeral });
          }
          return;
        }
        if (action === 'set_location_nickname') {
          const db = loadDb();
          const grouped = buildLocationGroupsFromEvents(Object.values(db.events || {}), config).slice(0, 25);
          if (!grouped.length) {
            await interaction.update({
              content: 'No event addresses found yet. Sync calendar fixtures first.',
              embeds: [],
              components: [createGoogleToolsRow(), createGoogleToolsRow2()]
            });
            return;
          }

          const token = Math.random().toString(36).slice(2, 12);
          pendingLocationAliasSelections.set(token, grouped);
          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`admin_location_alias_pick:${token}`)
              .setPlaceholder('Pick address + type to nickname')
              .addOptions(grouped.map((entry, idx) => {
                const nickname = getLocationNickname(config, entry.eventType, entry.location);
                return {
                  label: `(${eventTypeLabel(entry.eventType)}) ${entry.location}`.slice(0, 100),
                  value: String(idx),
                  description: `${entry.count} event(s)${nickname ? ` • Nickname: ${nickname}` : ''}`.slice(0, 100)
                };
              }))
          );

          await interaction.update({
            content: 'Select an address group to set a nickname.',
            embeds: [],
            components: [row, createBackButtonRow('admin_back_google_tools')]
          });
          return;
        }
        if (action === 'sync_backup') {
          const latestConfig = loadConfig();
          const backups = Array.isArray(latestConfig._configBackups) ? latestConfig._configBackups.slice(0, 5) : [];
          if (!backups.length) {
            await interaction.update({
              content: 'No config backups are available yet. Make at least one config change first.',
              embeds: [],
              components: [createGoogleToolsRow(), createGoogleToolsRow2()]
            });
            return;
          }

          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('admin_google_restore_backup')
              .setPlaceholder('Choose config backup to restore')
              .setMinValues(1)
              .setMaxValues(1)
              .addOptions(backups.map((backup, index) => ({
                label: `${new Date(backup.timestamp || Date.now()).toLocaleString()} • ${backup.reason || 'update'}`.slice(0, 100),
                value: String(index),
                description: `Path: ${backup.changedPath || 'n/a'}`.slice(0, 100)
              })))
          );

          await interaction.update({
            content: 'Select a backup snapshot to restore into active config.',
            embeds: [],
            components: [row, createBackButtonRow('admin_back_google_tools')]
          });
          return;
        }
        if (action === 'fresh_config') {
          const fresh = resetConfigFresh();
          await syncConfigSnapshotIfEnabled().catch(() => null);
          await interaction.update({
            content: '🧼 Config reset to fresh (blank) values.',
            embeds: [],
            components: [createGoogleToolsRow(), createGoogleToolsRow2()]
          });
          context.setConfig?.(fresh);
          return;
        }
      }
      if (interaction.customId.startsWith('admin_event_type_rule:')) {
        const selected = interaction.customId.split(':')[1];
        const latestConfig = loadConfig();

        if (selected === 'toggle_auto_detect') {
          updateConfig('eventTypes.autoDetect', !latestConfig.eventTypes?.autoDetect);
          const updated = getEventTypeConfig(loadConfig());
          await interaction.update({
            content: `✅ Auto detect is now **${updated.autoDetect ? 'ON' : 'OFF'}**.`,
            embeds: [],
            components: [createEventTypeRulesRow(), createEventTypeRulesRow2()]
          });
          return;
        }

        if (['set_practice_exact', 'set_match_exact', 'set_other_exact'].includes(selected)) {
          const modal = new ModalBuilder()
            .setCustomId(`admin_event_type_exact_modal:${selected}`)
            .setTitle('Set Exact Event Names');
          const current = selected === 'set_practice_exact'
            ? latestConfig.eventTypes?.practiceExactNames
            : selected === 'set_match_exact'
              ? latestConfig.eventTypes?.matchExactNames
              : latestConfig.eventTypes?.otherExactNames;
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('exact_names')
                .setLabel('Comma-separated exact names')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setValue((current || []).join(', '))
            )
          );
          await interaction.showModal(modal);
          return;
        }

        if (selected === 'manual_set_event_type') {
          const db = loadDb();
          const options = Object.entries(db.events || {})
            .map(([eventId, event]) => ({ eventId, ...event }))
            .filter((event) => new Date(event.date).getTime() >= Date.now())
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .slice(0, 25)
            .map((event) => ({
              label: `${new Date(event.date).toLocaleDateString()} — ${event.title}`.slice(0, 100),
              value: event.eventId
            }));

          if (!options.length) {
            await interaction.update({
              content: 'No upcoming events are available for manual type assignment.',
              embeds: [],
              components: [createEventTypeRulesRow(), createEventTypeRulesRow2()]
            });
            return;
          }

          await interaction.update({
            content: 'Select an event to assign type.',
            embeds: [],
            components: [
              new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId('admin_event_type_pick_event')
                  .setPlaceholder('Pick event')
                  .addOptions(options)
              ),
              createBackButtonRow('admin_back_club_management')
            ]
          });
          return;
        }
      }
      if (interaction.customId.startsWith('admin_team_management:')) {
        const action = interaction.customId.split(':')[1];
        if (action === 'new_team') {
          const modal = new ModalBuilder().setCustomId('admin_new_team_modal').setTitle('Create New Team');
          const keyInput = new TextInputBuilder().setCustomId('team_key').setLabel('Team key (letters/numbers, e.g. u18mens)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30);
          const labelInput = new TextInputBuilder().setCustomId('team_label').setLabel('Display name (e.g. U18 Mens)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80);
          const emojiInput = new TextInputBuilder().setCustomId('team_emoji').setLabel('Emoji (optional, default 🔹)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(20);
          const genderInput = new TextInputBuilder().setCustomId('team_gender').setLabel('Team gender (male/female/mixed)').setStyle(TextInputStyle.Short).setRequired(true).setValue('male').setMaxLength(10);
          modal.addComponents(new ActionRowBuilder().addComponents(keyInput), new ActionRowBuilder().addComponents(labelInput), new ActionRowBuilder().addComponents(emojiInput), new ActionRowBuilder().addComponents(genderInput));
          await interaction.showModal(modal);
          return;
        }
      }
      if (interaction.customId.startsWith('admin_player_page:')) {
        const page = Number.parseInt(interaction.customId.split(':')[1] || '0', 10);
        await interaction.guild?.members.fetch().catch(() => null);
        await interaction.update({
          content: getPlayerManagementSummary(),
          embeds: [],
          components: [...createPlayerManagementRows('player', interaction.guild, Number.isNaN(page) ? 0 : page), createAdminBackButtonRow()]
        });
        return;
      }
      if (interaction.customId === 'admin_back_coach_management') {
        await interaction.update({
          content: getCoachManagementSummary(),
          embeds: [],
          components: [createCoachManagementRow(loadConfig(), interaction.guild), createAdminBackButtonRow()]
        });
        return;
      }
      if (interaction.customId.startsWith('admin_back_team_config:')) {
        const team = interaction.customId.split(':')[1];
        const latestConfig = context.getConfig();
        await interaction.update({
          content: getTeamConfigSummary(latestConfig, interaction.guild, team),
          embeds: [],
          components: [createTeamConfigActionRow(latestConfig, team), createBackButtonRow('admin_back_team_management')]
        });
        return;
      }
      if (interaction.customId.startsWith('admin_team_config_action:')) {
        const [, team, selectedAction] = interaction.customId.split(':');
        const latestConfig = loadConfig();
        const teamLabel = getTeamMeta(latestConfig, team).label || team;
        if (selectedAction === 'id_settings') {
          await interaction.update({
            content: `${getTeamConfigSummary(latestConfig, interaction.guild, team)}\n\n**ID settings**`,
            embeds: [],
            components: [...createTeamConfigIdSettingsRows(team, latestConfig), createBackButtonRow(`admin_back_team_config:${team}`)]
          });
          return;
        }
        if (selectedAction === 'fixtures_settings') {
          await interaction.update({
            content: `${getTeamConfigSummary(latestConfig, interaction.guild, team)}\n\n**Fixture settings**`,
            embeds: [],
            components: [createTeamConfigFixtureSettingsRow(team), createBackButtonRow(`admin_back_team_config:${team}`)]
          });
          return;
        }
        if (selectedAction === 'player_role' || selectedAction === 'coach_role') {
          const label = selectedAction === 'player_role' ? `${teamLabel} Player Role` : `${teamLabel} Coach Role`;
          const path = selectedAction === 'player_role' ? `roles.${team}.player` : `roles.${team}.coach`;
          const row = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
              .setCustomId(`admin_set_role:${path}:${team}`)
              .setPlaceholder(`Choose ${label}`)
              .setMinValues(1)
              .setMaxValues(1)
          );
          await interaction.update({ content: `Select the role to assign for **${label}**.`, embeds: [], components: [row, createBackButtonRow(`admin_back_team_config:${team}`)] });
          return;
        }
        if (selectedAction === 'team_chat' || selectedAction === 'staff_room' || selectedAction === 'private_category') {
          const isCategory = selectedAction === 'private_category';
          const path = selectedAction === 'team_chat'
            ? `channels.teamChats.${team}`
            : selectedAction === 'staff_room'
              ? `channels.staffRooms.${team}`
              : `channels.privateChatCategories.${team}`;
          const label = selectedAction === 'team_chat' ? `${teamLabel} Team Chat` : selectedAction === 'staff_room' ? `${teamLabel} Staff Room` : `${teamLabel} Absence Chat Category`;
          const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId(`admin_set_channel:${path}:${team}`)
              .setPlaceholder(`Choose ${label}`)
              .setChannelTypes(isCategory ? ChannelType.GuildCategory : ChannelType.GuildText)
              .setMinValues(1)
              .setMaxValues(1)
          );
          await interaction.update({ content: `Select the ${isCategory ? 'category' : 'channel'} to assign for **${label}**.`, embeds: [], components: [row, createBackButtonRow(`admin_back_team_config:${team}`)] });
          return;
        }
        if (selectedAction === 'team_gender') {
          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`admin_set_team_gender:${team}`)
              .setPlaceholder(`Select ${teamLabel} gender`)
              .addOptions([
                { label: 'Male Team', value: 'male', description: 'Only male players can play for this team' },
                { label: 'Female Team', value: 'female', description: 'Only female players can play for this team' },
                { label: 'Mixed Team', value: 'mixed', description: 'Male and female players can play for this team' }
              ])
          );
          await interaction.update({
            content: `Select player gender requirement for **${teamLabel}**.`,
            embeds: [],
            components: [row, createBackButtonRow(`admin_back_team_config:${team}`)]
          });
          return;
        }
        if (selectedAction === 'team_emojis') {
          const modal = new ModalBuilder()
            .setCustomId(`admin_set_team_emojis_modal:${team}`)
            .setTitle(`Set ${teamLabel} Emojis`);
          const emojiInput = new TextInputBuilder().setCustomId('emoji').setLabel('Team emoji, e.g. 🔵').setStyle(TextInputStyle.Short).setRequired(true).setValue(getTeamMeta(latestConfig, team).emoji).setMaxLength(40);
          const captainEmojiInput = new TextInputBuilder().setCustomId('captain_emoji').setLabel('Captain emoji, e.g. 🅒').setStyle(TextInputStyle.Short).setRequired(true).setValue(latestConfig.teams?.[team]?.captainEmoji || '🅒').setMaxLength(40);
          modal.addComponents(new ActionRowBuilder().addComponents(emojiInput), new ActionRowBuilder().addComponents(captainEmojiInput));
          await interaction.showModal(modal);
          return;
        }
        if (selectedAction === 'team_name') {
          const modal = new ModalBuilder().setCustomId(`admin_set_team_name_modal:${team}`).setTitle(`Set ${teamLabel} Name`);
          const nameInput = new TextInputBuilder().setCustomId('team_name').setLabel('Team display name').setStyle(TextInputStyle.Short).setRequired(true).setValue(teamLabel).setMaxLength(80);
          modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
          await interaction.showModal(modal);
          return;
        }
        if (selectedAction === 'captain_role') {
          const row = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
              .setCustomId(`admin_set_role:teams.${team}.captainRoleId:${team}`)
              .setPlaceholder(`Choose ${teamLabel} Captain Role`)
              .setMinValues(1)
              .setMaxValues(1)
          );
          await interaction.update({
            content: `Select the role to assign for **${teamLabel} Captain Role**.`,
            embeds: [],
            components: [row, createBackButtonRow(`admin_back_team_config:${team}`)]
          });
          return;
        }
        if (selectedAction === 'event_name_phrases') {
          const modal = new ModalBuilder()
            .setCustomId(`admin_set_event_phrases_modal:${team}`)
            .setTitle(`Set ${teamLabel} Event Phrases`);
          const phrasesInput = new TextInputBuilder()
            .setCustomId('phrases')
            .setLabel('Comma-separated EXACT phrases')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setValue((latestConfig.teams?.[team]?.eventNamePhrases || []).join(', '))
            .setMaxLength(500);
          modal.addComponents(new ActionRowBuilder().addComponents(phrasesInput));
          await interaction.showModal(modal);
          return;
        }
        if (selectedAction === 'fixture_team') {
          const db = loadDb();
          const upcomingEvents = Object.entries(db.events || {})
            .map(([id, event]) => ({ id, ...event }))
            .filter((event) => new Date(event.date).getTime() >= Date.now())
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .slice(0, 25);

          if (!upcomingEvents.length) {
            await interaction.update({
              content: 'No upcoming fixtures found in synced events yet.',
              embeds: [],
              components: [createTeamConfigActionRow(latestConfig, team), createBackButtonRow('admin_back_team_management')]
            });
            return;
          }

          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`admin_set_fixture_team:${team}`)
              .setPlaceholder(`Select fixture for ${teamLabel}`)
              .addOptions(
                upcomingEvents.map((event) => {
                  const when = new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  return {
                    label: `${when} — ${event.title}`.slice(0, 100),
                    value: event.id,
                    description: `Current: ${getTeamMeta(latestConfig, event.team).label || 'Unassigned'}`.slice(0, 100)
                  };
                })
              )
          );

          await interaction.update({
            content: `Pick a fixture to assign to **${teamLabel}**.`,
            embeds: [],
            components: [row, createBackButtonRow(`admin_back_team_config:${team}`)]
          });
          return;
        }
        if (selectedAction === 'auto_assign_fixtures') {
          await interaction.deferUpdate();
          const db = loadDb();
          const teamMatchers = buildTeamMatchers(latestConfig);
          const assigned = [];

          for (const [eventId, event] of Object.entries(db.events || {})) {
            const normalizedTitle = String(event.title || '').toLowerCase();
            const matched = Object.entries(teamMatchers).find(([, phrases]) =>
              (phrases || []).some((phrase) => phrase && titleMatchesPhrase(normalizedTitle, phrase))
            );
            if (!matched) continue;

            const [matchedTeam] = matched;
            if (event.team !== matchedTeam) {
              db.events[eventId].team = matchedTeam;
              assigned.push({ eventId, title: event.title, date: event.date, team: matchedTeam });
            }
          }

          saveDb(db);
          await triggerGoogleSync(context);

          const preview = assigned
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .slice(0, 25);

          if (!preview.length) {
            await interaction.editReply({
              content: 'No fixtures changed from exact phrase matching. Update event phrases if needed.',
              embeds: [],
              components: [createTeamConfigActionRow(loadConfig(), team), createBackButtonRow('admin_back_team_management')]
            });
            return;
          }

          pendingFixtureCorrections.set(interaction.user.id, preview.map((item) => item.eventId));

          const correctionRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`admin_fixture_correction_dates:${team}`)
              .setPlaceholder('Select any wrong fixture dates (optional)')
              .setMinValues(0)
              .setMaxValues(preview.length)
              .addOptions(preview.map((item) => ({
                label: `${new Date(item.date).toLocaleDateString()} — ${item.title}`.slice(0, 100),
                value: item.eventId,
                description: `Assigned to ${getTeamMeta(latestConfig, item.team).label}`.slice(0, 100)
              })))
          );

          await interaction.editReply({
            content: [
              `✅ Auto-assigned ${assigned.length} fixture(s) by exact event-name phrase.`,
              'Review the list below. If any dates are wrong, select them next.'
            ].join('\n'),
            embeds: [],
            components: [correctionRow, createBackButtonRow(`admin_back_team_config:${team}`)]
          });
          return;
        }
        if (selectedAction === 'force_send_attendance') {
          await interaction.update({
            content: `Choose how far ahead to force-send attendance for **${teamLabel}**.`,
            embeds: [],
            components: [createForceAttendanceWindowRow(team), createBackButtonRow(`admin_back_team_config:${team}`)]
          });
          return;
        }
      }
      if (interaction.customId.startsWith('admin_open_team:')) {
        const team = interaction.customId.split(':')[1];
        const latestConfig = context.getConfig();
        await interaction.update({
          content: getTeamConfigSummary(latestConfig, interaction.guild, team),
          embeds: [],
          components: [createTeamConfigActionRow(latestConfig, team), createBackButtonRow('admin_back_team_management')]
        });
        return;
      }
      if (interaction.customId === 'admin_create_team_btn') {
        const modal = new ModalBuilder()
          .setCustomId('admin_new_team_modal')
          .setTitle('Create New Team');

        const keyInput = new TextInputBuilder()
          .setCustomId('team_key')
          .setLabel('Team key (letters/numbers, e.g. u18mens)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(30);

        const labelInput = new TextInputBuilder()
          .setCustomId('team_label')
          .setLabel('Display name (e.g. U18 Mens)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80);

        const emojiInput = new TextInputBuilder()
          .setCustomId('team_emoji')
          .setLabel('Emoji (optional, default 🔹)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(20);
        const genderInput = new TextInputBuilder()
          .setCustomId('team_gender')
          .setLabel('Team gender (male/female/mixed)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue('male')
          .setMaxLength(10);

        modal.addComponents(
          new ActionRowBuilder().addComponents(keyInput),
          new ActionRowBuilder().addComponents(labelInput),
          new ActionRowBuilder().addComponents(emojiInput),
          new ActionRowBuilder().addComponents(genderInput)
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId.startsWith('admin_player_action:')) {
        if (!hasAdminAccess(interaction.member, config)) {
          await denyAdminAccess();
          return;
        }
        const [, selectedAction, userId, mode = 'player'] = interaction.customId.split(':');
        await handleAdminPlayerAction(interaction, selectedAction, userId, mode);
        return;
      }

      if (interaction.customId.startsWith('admin_location_alias_pick:')) {
        const token = interaction.customId.split(':')[1];
        const options = pendingLocationAliasSelections.get(token) || [];
        const picked = options[Number(interaction.values[0])];
        if (!picked) {
          await interaction.update({
            content: 'That address option expired. Please reopen Set Address Nickname.',
            embeds: [],
            components: [createGoogleToolsRow(), createGoogleToolsRow2()]
          });
          return;
        }

        const modalToken = Math.random().toString(36).slice(2, 12);
        pendingLocationAliasSelections.set(modalToken, [picked]);
        const currentNickname = getLocationNickname(loadConfig(), picked.eventType, picked.location);
        const modal = new ModalBuilder()
          .setCustomId(`admin_location_alias_modal:${modalToken}`)
          .setTitle(`Set ${(eventTypeLabel(picked.eventType))} Address Nickname`);

        const nicknameInput = new TextInputBuilder()
          .setCustomId('location_nickname')
          .setLabel(`(${eventTypeLabel(picked.eventType)}) ${picked.location}`.slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(currentNickname)
          .setMaxLength(80);

        modal.addComponents(new ActionRowBuilder().addComponents(nicknameInput));
        await interaction.showModal(modal);
        return;
      }
      if (interaction.customId.startsWith('admin_player_note_add:')) {
        if (!hasAdminAccess(interaction.member, config) && !Object.values(config.roles || {}).some((r) => r?.coach && interaction.member?.roles?.cache?.has(r.coach))) {
          await denyAdminAccess();
          return;
        }
        const [, userId, mode = 'player'] = interaction.customId.split(':');
        const modal = new ModalBuilder().setCustomId(`admin_player_note_modal:add:${userId}:${mode}`).setTitle('Add Profile Note');
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('note_text').setLabel('Note').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)
        ));
        await interaction.showModal(modal);
        return;
      }
      if (interaction.customId.startsWith('admin_player_view_attendance:')) {
        const [, userId, mode = 'player'] = interaction.customId.split(':');
        await interaction.update({
          content: [
            buildAttendanceStatsMessage(userId, loadConfig()),
            '',
            'Pick what attendance type to view: Practices, Matches, Other, or All.'
          ].join('\n'),
          embeds: [],
          components: createAttendanceResultRows(userId, mode, 'all')
        });
        return;
      }
      if (interaction.customId.startsWith('admin_player_attendance_type:')) {
        const [, userId, mode = 'player', type = 'all'] = interaction.customId.split(':');
        await interaction.update({
          content: buildDetailedAttendanceMessage(userId, loadConfig(), type),
          embeds: [],
          components: createAttendanceResultRows(userId, mode, type)
        });
        return;
      }
      if (interaction.customId.startsWith('admin_player_attendance_export:')) {
        const [, userId, mode = 'player', type = 'all'] = interaction.customId.split(':');
        await interaction.reply({
          content: `\`\`\`\n${buildDetailedAttendanceMessage(userId, loadConfig(), type).slice(0, 1800)}\n\`\`\``,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      if (interaction.customId.startsWith('admin_player_absence_reasons:')) {
        const [, userId, mode = 'player', type = 'all'] = interaction.customId.split(':');
        const db = loadDb();
        const events = Object.values(db.events || {})
          .filter((event) => event.responses?.[userId] && event.responses[userId].status !== 'yes')
          .filter((event) => type === 'all' || determineEventType(event, loadConfig()) === type)
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .slice(0, 20);
        const lines = events.length
          ? events.map((event) => {
            const response = event.responses[userId];
            return `• ${new Date(event.date).toLocaleDateString()} — ${event.title}\n  🧾 ${response.reason || 'No reason provided'}`;
          })
          : ['No absence reasons found for this filter.'];
        await interaction.reply({ content: lines.join('\n\n').slice(0, 1900), flags: MessageFlags.Ephemeral });
        return;
      }
      if (interaction.customId.startsWith('admin_player_absence_logs:')) {
        const [, userId] = interaction.customId.split(':');
        const db = loadDb();
        const tickets = Object.values(db.absenceTickets || {})
          .filter((ticket) => ticket.playerId === userId)
          .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
          .slice(0, 10);
        const lines = tickets.length
          ? tickets.map((ticket) => `• ${new Date(ticket.createdAt || Date.now()).toLocaleDateString()} — ${ticket.team || 'unknown'} — ${ticket.closedReason || 'open'}\n  🔗 Ticket: ${ticket.ticketId ? `<#${ticket.ticketId}>` : 'deleted channel'}\n  📌 Log entries: ${(ticket.chatLog || []).length}`)
          : ['No absence ticket logs found for this player.'];
        await interaction.reply({ content: lines.join('\n\n').slice(0, 1900), flags: MessageFlags.Ephemeral });
        return;
      }
      if (interaction.customId.startsWith('admin_player_back_to_profile:')) {
        const [, userId, mode = 'player'] = interaction.customId.split(':');
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        const user = member?.user || await interaction.client.users.fetch(userId).catch(() => null);
        const profile = upsertPlayerProfile(userId, { userId });
        await interaction.update({
          ...buildPlayerProfileView(loadConfig(), interaction.guild, user, member, profile, mode),
          components: [createPlayerProfileActionRow(userId, mode), createPlayerProfileActionRow2(userId, mode), createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')]
        });
        return;
      }

      if (
        interaction.customId.startsWith('absence_open_profile:')
      ) {
        const [, mode, userId] = interaction.customId.split(':');
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        const user = member?.user || await interaction.client.users.fetch(userId).catch(() => null);
        const profile = upsertPlayerProfile(userId, { userId });
        await interaction.reply({
          ...buildPlayerProfileView(loadConfig(), interaction.guild, user, member, profile, mode === 'admin' ? 'player' : 'coach'),
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (
        interaction.customId.startsWith('absence_ticket_log:')
      ) {
        const ticketId = interaction.customId.split(':')[1];
        const db = loadDb();
        const ticket = db.absenceTickets?.[ticketId];
        if (!ticket) {
          await interaction.reply({ content: 'Absence ticket log not found.', flags: MessageFlags.Ephemeral });
          return;
        }

        const canAdmin = hasAdminAccess(interaction.member, config);
        const teamCoachRole = config.roles?.[ticket.team]?.coach;
        const canCoach = teamCoachRole && interaction.member?.roles?.cache?.has(teamCoachRole);
        if (!canAdmin && !canCoach) {
          await interaction.reply({ content: 'Only team coaches/admins can view this ticket log.', flags: MessageFlags.Ephemeral });
          return;
        }

        const entries = Array.isArray(ticket.chatLog) ? ticket.chatLog.slice(-60) : [];
        const lines = [];
        let lastDay = '';
        for (const item of entries) {
          if (typeof item === 'string') {
            lines.push(item);
            continue;
          }
          const day = item.day || String(item.ts || '').slice(0, 10) || 'unknown-day';
          const time = item.time || String(item.ts || '').slice(11, 16) || '??:??';
          const name = item.name || getPlayerDisplayName(item.userId || '', loadConfig()) || 'unknown';
          const text = item.message || '(no text)';
          if (day !== lastDay) {
            lines.push(`\n📅 ${day}`);
            lastDay = day;
          }
          lines.push(`${time} — ${name}: ${text}`);
        }
        await interaction.reply({
          content: [
            `📜 Absence Ticket Log (${ticket.team || 'unknown'})`,
            `Player: <@${ticket.playerId}>`,
            `Event: ${ticket.eventId}`,
            `Status: ${ticket.status || 'unknown'}`,
            '',
            lines.length ? lines.join('\n') : 'No saved chat log entries.'
          ].join('\n').slice(0, 1950),
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (
        interaction.customId === 'absence_ticket_confirm'
        || interaction.customId === 'absence_ticket_decline'
        || interaction.customId === 'absence_ticket_player_attend'
        || interaction.customId.startsWith('absence_ticket_confirm:')
        || interaction.customId.startsWith('absence_ticket_decline:')
        || interaction.customId.startsWith('absence_ticket_player_attend:')
        || interaction.customId.startsWith('absence_dm_attend:')
      ) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const db = loadDb();
        const dmToken = interaction.customId.startsWith('absence_dm_attend:') ? interaction.customId.split(':')[1] : '';
        const dmPayload = dmToken ? pendingPlayerAttendDmTokens.get(dmToken) : null;
        const legacyParts = interaction.customId.split(':');
        const channelTicket = interaction.channelId ? db.absenceTickets?.[interaction.channelId] : null;
        const eventId = dmPayload?.eventId || channelTicket?.eventId || legacyParts[1];
        const playerId = dmPayload?.playerId || channelTicket?.playerId || legacyParts[2];
        const event = db.events[eventId];
        if (!event) {
          await interaction.editReply({ content: 'Event no longer exists for this ticket.' });
          return;
        }

        const teamRoles = teamRolesMap[event.team];

        if (interaction.customId === 'absence_ticket_player_attend' || interaction.customId.startsWith('absence_ticket_player_attend:') || interaction.customId.startsWith('absence_dm_attend:')) {
          if (interaction.user.id !== playerId) {
            await interaction.editReply({ content: 'Only the player can use this button.' });
            return;
          }
          setResponse(eventId, playerId, {
            status: 'yes',
            reason: '',
            confirmed: false,
            updatedAt: new Date().toISOString()
          });
          setAbsenceTicket(interaction.channelId, {
            status: 'closed',
            coachDecision: 'player_attending',
            closedAt: new Date().toISOString(),
            closedReason: 'Player confirmed they can attend.'
          });
          await triggerGoogleSync(context);
          await interaction.editReply({ content: '🟢 Marked as attending. Closing this absence chat now.' });
          await interaction.user.send(`✅ You are now marked as attending for **${event.title}** (${getCompactDateLabel(event.date)}).`).catch(() => null);
          if (dmToken) pendingPlayerAttendDmTokens.delete(dmToken);
          await context.sendLog(`🟢 <@${playerId}> switched to attending for **${event.title}** from the ticket channel.`);
          await closeAbsenceTicketChannel(interaction.channel, 'Player confirmed attending');
          return;
        }

        if (!teamRoles?.coach || !hasRole(interaction.member, teamRoles.coach)) {
          await interaction.editReply({ content: 'Only team coaches/staff can use this decision button.' });
          return;
        }

        if (interaction.customId === 'absence_ticket_confirm' || interaction.customId.startsWith('absence_ticket_confirm:')) {
          setResponse(eventId, playerId, {
            status: 'confirmed_no',
            confirmed: true,
            confirmedBy: interaction.user.id,
            confirmedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          setAbsenceTicket(interaction.channelId, {
            status: 'closed',
            coachDecision: 'confirmed_not_attending',
            coachId: interaction.user.id,
            coachName: interaction.user.tag,
            closedAt: new Date().toISOString(),
            closedReason: 'Coach confirmed not attending.'
          });
          await triggerGoogleSync(context);
          await interaction.editReply({ content: `✅ Absence confirmed for <@${playerId}>. Closing this absence chat now.` });
          const member = await interaction.guild.members.fetch(playerId).catch(() => null);
          await member?.send(`✅ Your not-attending request for **${event.title}** (${getCompactDateLabel(event.date)}) was confirmed by **${interaction.user.tag}**.`).catch(() => null);
          await context.sendLog(`✅ ${interaction.user.tag} confirmed not attending for <@${playerId}> on **${event.title}**.`);
          await closeAbsenceTicketChannel(interaction.channel, 'Absence confirmed by coach');
          return;
        }

        clearResponse(eventId, playerId);
        await triggerGoogleSync(context);
        const member = await interaction.guild.members.fetch(playerId).catch(() => null);
        const newDmToken = Math.random().toString(36).slice(2, 12);
        pendingPlayerAttendDmTokens.set(newDmToken, { eventId, playerId });
        await member?.send({
          content: `Your absence request for **${event.title}** (${getCompactDateLabel(event.date)}) was declined. Press below to confirm you can attend.`,
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`absence_dm_attend:${newDmToken}`)
              .setLabel('🟢 I can attend')
              .setStyle(ButtonStyle.Primary)
          )]
        }).catch(() => null);
        await interaction.editReply({
          content: [
            `↩️ Absence request declined for <@${playerId}>.`,
            'Player has been asked in DM to confirm they can attend. Closing this absence chat now.'
          ].join('\n')
        });
        setAbsenceTicket(interaction.channelId, {
          status: 'closed',
          coachDecision: 'declined_asked_to_attend',
          coachId: interaction.user.id,
          coachName: interaction.user.tag,
          closedAt: new Date().toISOString(),
          closedReason: 'Coach declined absence and asked player to attend.'
        });
        await context.sendLog(`↩️ ${interaction.user.tag} declined not-attending request for <@${playerId}> on **${event.title}**.`);
        await closeAbsenceTicketChannel(interaction.channel, 'Absence declined by coach');
        return;
      }

      const parsed = parseCustomId(interaction.customId);
      const db = loadDb();
      let event = db.events[parsed.eventId];

      if (!event) {
        try {
          const refreshed = await fetchCalendarEvents({
            calendarId: config.bot.calendarId,
            daysAhead: null,
            credentialsPath: config.bot.calendarCredentialsPath || '',
            teamMatchers: buildTeamMatchers(config)
          });
          const matched = refreshed.find((item) => item.id === parsed.eventId);
          if (matched) {
            db.events[matched.id] = {
              id: matched.id,
              title: matched.title,
              date: matched.date,
              location: matched.location || '',
              team: matched.team || '',
              responses: {},
              discordMessageId: '',
              updatedAt: new Date().toISOString()
            };
            saveDb(db);
            event = db.events[parsed.eventId];
          }
        } catch (error) {
          await context.sendLog(`⚠️ Could not refresh missing event ${parsed.eventId}: ${error.message}`);
        }
      }

      if (!event) {
        await interaction.reply({ content: 'Event not found. Please ask an admin to re-sync fixtures.', flags: MessageFlags.Ephemeral });
        return;
      }

      const teamRoles = teamRolesMap[event.team];
      if (!teamRoles) {
        await interaction.reply({ content: 'Team roles are not configured for this event.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (parsed.action === 'attend_yes') {
        if (!hasRole(interaction.member, teamRoles.player) && !hasRole(interaction.member, teamRoles.coach)) {
          await interaction.reply({ content: 'Only players/coaches for this team can respond.', flags: MessageFlags.Ephemeral });
          return;
        }
        const profile = getPlayerProfile(interaction.user.id) || {};
        const requiredGender = config.teams?.[event.team]?.gender;
        if (!teamAllowsGender(requiredGender, profile.gender)) {
          await interaction.reply({ content: getGenderMismatchMessage(getTeamMeta(config, event.team).label, requiredGender), flags: MessageFlags.Ephemeral });
          return;
        }

        const existing = db.events[parsed.eventId]?.responses?.[interaction.user.id];
        if (existing?.status === 'yes') {
          await interaction.reply({ content: 'You are already marked as attending for this event.', flags: MessageFlags.Ephemeral });
          return;
        }

        const responderType = hasRole(interaction.member, teamRoles.coach) && !hasRole(interaction.member, teamRoles.player)
          ? 'coach'
          : 'player';
        setResponse(parsed.eventId, interaction.user.id, {
          status: 'yes',
          reason: '',
          confirmed: false,
          responderType,
          username: getPlayerDisplayName(interaction.user.id, interaction.user.tag),
          updatedAt: new Date().toISOString()
        });

        const attendanceName = getPlayerDisplayName(interaction.user.id, interaction.user.tag);
        await interaction.reply({ content: '✅ You are marked as attending.', flags: MessageFlags.Ephemeral });
        await triggerGoogleSync(context);
        await context.sendLog(`🟢 ${attendanceName} marked attending for **${event.title}** (${getEventDateLabel(event.date)}).`);
        return;
      }

      if (parsed.action === 'attend_no') {
        if (!hasRole(interaction.member, teamRoles.player) && !hasRole(interaction.member, teamRoles.coach)) {
          await interaction.reply({ content: 'Only players/coaches for this team can respond.', flags: MessageFlags.Ephemeral });
          return;
        }

        const profile = getPlayerProfile(interaction.user.id) || {};
        const requiredGender = config.teams?.[event.team]?.gender;
        if (!teamAllowsGender(requiredGender, profile.gender)) {
          await interaction.reply({ content: getGenderMismatchMessage(getTeamMeta(config, event.team).label, requiredGender), flags: MessageFlags.Ephemeral });
          return;
        }

        const responderType = hasRole(interaction.member, teamRoles.coach) && !hasRole(interaction.member, teamRoles.player)
          ? 'coach'
          : 'player';
        const modalToken = `${parsed.eventId}:${interaction.user.id}`.slice(-80);
        pendingAbsenceReasonModals.set(modalToken, parsed.eventId);
        const modal = new ModalBuilder()
          .setCustomId(`absence_reason_token:${modalToken}`)
          .setTitle('Not Attending');

        const reasonInput = new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason for not attending')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500);

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        await interaction.showModal(modal);
        return;
      }

      if (parsed.action === 'confirm_no') {
        const targetUserId = parsed.userId;

        if (!targetUserId) {
          await interaction.reply({ content: 'Invalid confirmation button.', flags: MessageFlags.Ephemeral });
          return;
        }

        if (!hasRole(interaction.member, teamRoles.coach)) {
          await interaction.reply({ content: 'Only coaches can confirm absences.', flags: MessageFlags.Ephemeral });
          return;
        }

        const existing = db.events[parsed.eventId]?.responses?.[targetUserId];

        if (!existing || existing.status !== 'pending_no') {
          await interaction.reply({ content: 'This absence is no longer pending.', flags: MessageFlags.Ephemeral });
          return;
        }

        setResponse(parsed.eventId, targetUserId, {
          status: 'confirmed_no',
          confirmed: true,
          confirmedBy: interaction.user.id,
          confirmedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        await interaction.reply({ content: `✅ Absence confirmed for <@${targetUserId}>.` });
        const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
        await targetMember?.send(`✅ Your not-attending request for **${event.title}** (${getCompactDateLabel(event.date)}) was confirmed by **${interaction.user.tag}**.`).catch(() => null);
        await triggerGoogleSync(context);
        deleteAbsenceTicket(interaction.channelId);
        await context.sendLog(`✅ ${interaction.user.tag} confirmed absence for <@${targetUserId}> on **${event.title}**.`);

        try {
          await interaction.channel.delete('Absence confirmed via button');
        } catch (error) {
          console.error('Failed to delete ticket channel:', error);
        }

        return;
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('admin_') && !hasAdminAccess(interaction.member, config)) {
        await denyAdminAccess();
        return;
      }

      if (interaction.customId === 'admin_google_restore_backup') {
        const backupIndex = Number.parseInt(interaction.values?.[0] || '0', 10);
        const restored = restoreConfigFromBackup(Number.isNaN(backupIndex) ? 0 : backupIndex);
        if (!restored) {
          await interaction.update({
            content: 'Could not restore that backup snapshot.',
            embeds: [],
            components: [createGoogleToolsRow(), createGoogleToolsRow2()]
          });
          return;
        }
        await syncConfigSnapshotIfEnabled().catch(() => null);
        context.setConfig?.(restored);
        await interaction.update({
          content: '✅ Restored config from backup snapshot.',
          embeds: [],
          components: [createGoogleToolsRow(), createGoogleToolsRow2()]
        });
        return;
      }

      if (interaction.customId === 'coach_team_select') {
        const selectedTeam = interaction.values[0];
        const targetGuild = interaction.guild
          || await interaction.client.guilds.fetch(config.bot?.guildId || '').catch(() => null);
        if (!targetGuild) {
          await interaction.update({ content: 'Could not resolve the server for this coach report.', embeds: [], components: [] });
          return;
        }
        const report = coachCommand.buildReport(targetGuild, selectedTeam, teamRolesMap);

        const embed = new EmbedBuilder()
          .setTitle(`Coach UI — ${selectedTeam}`)
          .setDescription(report)
          .setColor(0x3498db);

        await interaction.update({ content: 'Coach report loaded.', embeds: [embed], components: [] });
        return;
      }

      if (interaction.customId === 'attendance_report_profile_select') {
        const userId = interaction.values[0];
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        const user = member?.user || await interaction.client.users.fetch(userId).catch(() => null);
        const profile = upsertPlayerProfile(userId, { userId });
        await interaction.update({
          ...buildPlayerProfileView(loadConfig(), interaction.guild, user, member, profile, 'player'),
          components: [createAttendanceOnlyRow(userId)]
        });
        return;
      }

      if (interaction.customId === 'admin_coach_pick') {
        const userId = interaction.values[0];
        if (userId === 'none') {
          await interaction.reply({ content: 'No coaches found yet. Assign coach roles first.', flags: MessageFlags.Ephemeral });
          return;
        }
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        const user = member?.user || await interaction.client.users.fetch(userId).catch(() => null);
        const existing = getPlayerProfile(userId) || {};
        const inferredCoachTeams = Object.keys(loadConfig().roles || {}).filter((teamKey) => {
          const roleId = loadConfig().roles?.[teamKey]?.coach;
          return roleId && roleId !== 'ROLE_ID' && member?.roles?.cache?.has(roleId);
        });
        const seeded = upsertPlayerProfile(userId, {
          ...existing,
          userId,
          coachTeams: Array.from(new Set([...(existing.coachTeams || []), ...inferredCoachTeams]))
        });
        await interaction.update({
          ...buildPlayerProfileView(loadConfig(), interaction.guild, user, member, seeded, 'coach'),
          components: [createPlayerProfileActionRow(userId, 'coach'), createPlayerProfileActionRow2(userId, 'coach'), createBackButtonRow('admin_back_coach_management')]
        });
        return;
      }

      if (interaction.customId === 'admin_player_pick') {
        const userId = interaction.values[0];
        if (userId === 'none') {
          await interaction.reply({ content: 'No players found yet. Assign player roles first.', flags: MessageFlags.Ephemeral });
          return;
        }
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        const user = member?.user || await interaction.client.users.fetch(userId).catch(() => null);
        const existing = getPlayerProfile(userId) || {};
        const inferredPlayerTeams = Object.keys(loadConfig().roles || {}).filter((teamKey) => {
          const roleId = loadConfig().roles?.[teamKey]?.player;
          return roleId && roleId !== 'ROLE_ID' && member?.roles?.cache?.has(roleId);
        });
        const inferredCoachTeams = Object.keys(loadConfig().roles || {}).filter((teamKey) => {
          const roleId = loadConfig().roles?.[teamKey]?.coach;
          return roleId && roleId !== 'ROLE_ID' && member?.roles?.cache?.has(roleId);
        });
        const seeded = upsertPlayerProfile(userId, {
          userId,
          customName: existing.customName || '',
          shirtNumber: existing.shirtNumber || '',
          teams: Array.from(new Set([...(existing.teams || []), ...inferredPlayerTeams])),
          coachTeams: Array.from(new Set([...(existing.coachTeams || []), ...inferredCoachTeams])),
          roles: existing.roles || (member ? Array.from(member.roles.cache.keys()).filter((id) => id !== interaction.guild.id) : []),
          joinedDiscordAt: existing.joinedDiscordAt || (member?.joinedAt ? member.joinedAt.toISOString().slice(0, 10) : ''),
          faceImageUrl: existing.faceImageUrl || existing.facePngUrl || '',
          facePngUrl: existing.faceImageUrl || existing.facePngUrl || '',
          notes: existing.notes || ''
        });

        await interaction.update({
          ...buildPlayerProfileView(loadConfig(), interaction.guild, user, member, seeded, 'player'),
          components: [createPlayerProfileActionRow(userId, 'player'), createPlayerProfileActionRow2(userId, 'player'), createBackButtonRow('admin_back_player_management')]
        });
        await triggerGoogleSync(context);
        return;
      }

      if (interaction.customId === 'admin_sheet_backup_restore_pick') {
        const slot = Number.parseInt(interaction.values[0] || '0', 10);
        const backups = await loadSheetBackups(loadConfig()).catch(() => []);
        const picked = backups.find((entry) => entry.slot === slot);
        if (!picked?.snapshot) {
          await interaction.update({ content: 'Backup slot is empty.', embeds: [], components: [createBackButtonRow('admin_back_club_management')] });
          return;
        }
        try {
          const parsed = JSON.parse(picked.snapshot);
          const progressState = { percent: 0, etaMs: 0, currentTab: '', tabs: [] };
          let lastProgressEdit = 0;
          await interaction.update({
            content: progressLines({
              title: `♻️ Restoring backup slot ${slot} (**${picked.name || `Backup ${slot}`}**)`,
              ...progressState
            }),
            embeds: [],
            components: [createBackButtonRow('admin_back_club_management')]
          });

          await restoreSpreadsheetFromBackupSnapshot(loadConfig(), parsed, (progress) => {
            progressState.percent = progress.percent;
            progressState.etaMs = progress.etaMs;
            progressState.currentTab = progress.currentTab;
            progressState.tabs = progress.tabs || [];
            const now = Date.now();
            if (now - lastProgressEdit >= 600) {
              lastProgressEdit = now;
              interaction.editReply({
                content: progressLines({
                  title: `♻️ Restoring backup slot ${slot} (**${picked.name || `Backup ${slot}`}**)`,
                  ...progressState
                }),
                embeds: [],
                components: [createBackButtonRow('admin_back_club_management')]
              }).catch(() => null);
            }
          });
          const restoredConfig = await loadConfigFromSheet(loadConfig()).catch(() => null);
          if (restoredConfig) {
            saveConfig(restoredConfig);
            context.setConfig?.(restoredConfig);
          }

          await interaction.editReply({
            content: progressLines({
              title: `✅ Restored backup slot ${slot}: **${picked.name || `Backup ${slot}`}**`,
              percent: 100,
              etaMs: 0,
              currentTab: progressState.currentTab,
              tabs: progressState.tabs
            }),
            embeds: [],
            components: [createBackButtonRow('admin_back_club_management')]
          });
        } catch (error) {
          await interaction.editReply({ content: `Could not restore backup: ${error.message}`, embeds: [], components: [createBackButtonRow('admin_back_club_management')] });
        }
        return;
      }

      if (interaction.customId.startsWith('admin_sheet_backup_overwrite_pick:')) {
        const token = interaction.customId.split(':')[1];
        const pending = pendingSheetBackupWrites.get(token);
        pendingSheetBackupWrites.delete(token);
        if (!pending) {
          await interaction.update({ content: 'Backup request expired. Try again.', embeds: [], components: [createBackButtonRow('admin_back_club_management')] });
          return;
        }
        const slot = Number.parseInt(interaction.values[0] || '1', 10);
        const config = loadConfig();
        const progressState = { percent: 0, etaMs: 0, currentTab: '', tabs: [] };
        let lastProgressEdit = 0;
        await interaction.update({
          content: progressLines({
            title: `💾 Saving backup **${pending.name}** to slot ${slot}`,
            ...progressState
          }),
          embeds: [],
          components: [createBackButtonRow('admin_back_club_management')]
        });
        const built = await buildSpreadsheetBackupSnapshot(config, (progress) => {
          progressState.percent = progress.percent;
          progressState.etaMs = progress.etaMs;
          progressState.currentTab = progress.currentTab;
          progressState.tabs = progress.tabs || [];
          const now = Date.now();
          if (now - lastProgressEdit >= 600) {
            lastProgressEdit = now;
            interaction.editReply({
              content: progressLines({
                title: `💾 Saving backup **${pending.name}** to slot ${slot}`,
                ...progressState
              }),
              embeds: [],
              components: [createBackButtonRow('admin_back_club_management')]
            }).catch(() => null);
          }
        });
        if (!built.ok) {
          await interaction.editReply({
            content: 'Could not save backup: spreadsheet ID is missing.',
            embeds: [],
            components: [createBackButtonRow('admin_back_club_management')]
          });
          return;
        }
        await interaction.editReply({
          content: progressLines({
            title: `💾 Saving backup **${pending.name}** to slot ${slot}`,
            percent: 95,
            etaMs: 0,
            currentTab: 'Writing backup row',
            tabs: progressState.tabs
          }),
          embeds: [],
          components: [createBackButtonRow('admin_back_club_management')]
        });
        try {
          await Promise.race([
            saveSheetBackupSlot(config, { slot, name: pending.name, createdBy: `${interaction.user.tag}`, summary: pending.summary, snapshot: JSON.stringify(built.snapshot) }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Backup write timed out after 90 seconds. Please try again.')), 90_000))
          ]);
        } catch (error) {
          await interaction.editReply({
            content: [
              `❌ Could not save backup **${pending.name}** to slot ${slot}.`,
              `Reason: ${error.message}`
            ].join('\n'),
            embeds: [],
            components: [createBackButtonRow('admin_back_club_management')]
          });
          return;
        }
        await interaction.editReply({
          content: progressLines({
            title: `✅ Saved backup **${pending.name}** to slot ${slot}`,
            percent: 100,
            etaMs: 0,
            currentTab: progressState.currentTab,
            tabs: progressState.tabs
          }),
          embeds: [],
          components: [createBackButtonRow('admin_back_club_management')]
        });
        return;
      }


      if (interaction.customId === 'admin_event_type_rules_action') {
        const selected = interaction.values[0];
        const latestConfig = loadConfig();

        if (selected === 'toggle_auto_detect') {
          updateConfig('eventTypes.autoDetect', !latestConfig.eventTypes?.autoDetect);
          const updated = getEventTypeConfig(loadConfig());
          await interaction.update({
            content: `✅ Auto detect is now **${updated.autoDetect ? 'ON' : 'OFF'}**.`,
            embeds: [],
            components: [createEventTypeRulesRow(), createEventTypeRulesRow2()]
          });
          return;
        }

        if (['set_practice_exact', 'set_match_exact', 'set_other_exact'].includes(selected)) {
          const modal = new ModalBuilder()
            .setCustomId(`admin_event_type_exact_modal:${selected}`)
            .setTitle('Set Exact Event Names');
          const current = selected === 'set_practice_exact'
            ? latestConfig.eventTypes?.practiceExactNames
            : selected === 'set_match_exact'
              ? latestConfig.eventTypes?.matchExactNames
              : latestConfig.eventTypes?.otherExactNames;
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('exact_names')
                .setLabel('Comma-separated exact names')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setValue((current || []).join(', '))
            )
          );
          await interaction.showModal(modal);
          return;
        }

        if (selected === 'manual_set_event_type') {
          const db = loadDb();
          const options = Object.entries(db.events || {})
            .map(([eventId, event]) => ({ eventId, ...event }))
            .filter((event) => new Date(event.date).getTime() >= Date.now())
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .slice(0, 25)
            .map((event) => ({
              label: `${new Date(event.date).toLocaleDateString()} — ${event.title}`.slice(0, 100),
              value: event.eventId
            }));

          if (!options.length) {
            await interaction.update({
              content: 'No upcoming events are available for manual type assignment.',
              embeds: [],
              components: [createEventTypeRulesRow(), createEventTypeRulesRow2()]
            });
            return;
          }

          await interaction.update({
            content: 'Select an event to assign type.',
            embeds: [],
            components: [
              new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId('admin_event_type_pick_event')
                  .setPlaceholder('Pick event')
                  .addOptions(options)
              ),
              createBackButtonRow('admin_back_club_management')
            ]
          });
          return;
        }
      }

      if (interaction.customId === 'admin_event_type_pick_event') {
        const eventId = interaction.values[0];
        await interaction.update({
          content: 'Choose event type:',
          embeds: [],
          components: [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId(`admin_event_type_set:${eventId}`)
                .setPlaceholder('Set type')
                .addOptions([
                  { label: 'Practice', value: 'practice' },
                  { label: 'Match', value: 'match' },
                  { label: 'Other', value: 'other' }
                ])
            ),
            createBackButtonRow('admin_back_club_management')
          ]
        });
        return;
      }

      if (interaction.customId.startsWith('admin_event_type_set:')) {
        const eventId = interaction.customId.split(':')[1];
        const eventType = interaction.values[0];
        const db = loadDb();
        if (!db.events[eventId]) {
          await interaction.reply({ content: 'Event not found.', flags: MessageFlags.Ephemeral });
          return;
        }
        db.events[eventId].type = eventType;
        db.events[eventId].updatedAt = new Date().toISOString();
        saveDb(db);
        await triggerGoogleSync(context);
        await interaction.update({
          content: `✅ Event type set to **${eventTypeLabel(eventType)}** for **${db.events[eventId].title}**.`,
          embeds: [],
          components: [createEventTypeRulesRow(), createEventTypeRulesRow2()]
        });
        return;
      }

      if (interaction.customId === 'admin_team_config_select') {
        const team = interaction.values[0];
        const latestConfig = context.getConfig();
        await interaction.update({
          content: getTeamConfigSummary(latestConfig, interaction.guild, team),
          embeds: [],
          components: [createTeamConfigActionRow(latestConfig, team), createBackButtonRow('admin_back_team_management')]
        });
        return;
      }

      if (interaction.customId === 'admin_view_events_scope') {
        const scope = interaction.values[0];
        const latestConfig = loadConfig();

        try {
          await interaction.deferUpdate();
          await setProgressReply(interaction, 0, 'Loading fixtures from Google Calendar...');

          const events = await fetchCalendarEvents({
            calendarId: latestConfig.bot.calendarId,
            daysAhead: null,
            credentialsPath: latestConfig.bot.calendarCredentialsPath || '',
            teamMatchers: buildTeamMatchers(latestConfig)
          });

          await setProgressReply(interaction, 45, 'Saving fixtures and syncing Sheets...');
          const db = loadDb();
          for (const event of events) {
            const existing = db.events[event.id] || {};
            db.events[event.id] = {
              ...existing,
              title: event.title,
              date: event.date,
              location: event.location || existing.location || '',
              team: existing.team || event.team,
              discordMessageId: existing.discordMessageId || '',
              responses: existing.responses || {},
              updatedAt: new Date().toISOString()
            };
          }
          saveDb(db);
          await triggerGoogleSync(context);

          const scopedEvents = scope === 'all'
            ? events
            : events.filter((event) => event.team === scope);

          await setProgressReply(interaction, 80, 'Formatting fixture view...');
          const lines = buildMonthGroupedEventLines(scopedEvents, loadDb(), interaction.guild, teamRolesMap, latestConfig);
          const scopeLabel = scope === 'all' ? 'All Teams' : getTeamMeta(latestConfig, scope).label;
          const chunks = chunkLines(lines, 15);
          const embeds = chunks.map((chunk, index) => new EmbedBuilder()
            .setTitle(`Google Calendar — ${scopeLabel} Fixtures (${scopedEvents.length})`)
            .setDescription(chunk.join('\n'))
            .setColor(0x2ecc71)
            .setFooter({ text: `Page ${index + 1} of ${chunks.length}` }));

          await interaction.editReply({
            content: `${renderProgressMessage(100, 'Fixtures loaded.')}\nReturning to admin panel.`,
            embeds: [embeds[0]],
            components: withOptionalRow([createAdminQuickActionRow(), createAdminQuickActionExtraRow()])
          });

          for (let i = 1; i < embeds.length; i += 1) {
            await interaction.followUp({
              embeds: [embeds[i]],
              flags: MessageFlags.Ephemeral
            });
          }
        } catch (error) {
          await interaction.editReply({
            content: `Could not load calendar events: ${error.message}`,
            embeds: [],
            components: [createGoogleToolsRow(), createGoogleToolsRow2(), createAdminBackButtonRow()]
          });
        }
        return;
      }

      if (interaction.customId.startsWith('admin_team_config_action:')) {
        const [, team, selectedAction] = interaction.customId.split(':');
        const teamLabel = getTeamMeta(config, team).label || team;

        if (selectedAction === 'player_role' || selectedAction === 'coach_role') {
          const label = selectedAction === 'player_role' ? `${teamLabel} Player Role` : `${teamLabel} Coach Role`;
          const path = selectedAction === 'player_role' ? `roles.${team}.player` : `roles.${team}.coach`;
          const row = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
              .setCustomId(`admin_set_role:${path}:${team}`)
              .setPlaceholder(`Choose ${label}`)
              .setMinValues(1)
              .setMaxValues(1)
          );

          await interaction.update({
            content: `Select the role to assign for **${label}**.`,
            embeds: [],
            components: [row, createBackButtonRow(`admin_back_team_config:${team}`)]
          });
          return;
        }

        if (selectedAction === 'captain_role') {
          const row = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
              .setCustomId(`admin_set_role:teams.${team}.captainRoleId:${team}`)
              .setPlaceholder(`Choose ${teamLabel} Captain Role`)
              .setMinValues(1)
              .setMaxValues(1)
          );
          await interaction.update({
            content: `Select the role to assign for **${teamLabel} Captain Role**.`,
            embeds: [],
            components: [row, createBackButtonRow(`admin_back_team_config:${team}`)]
          });
          return;
        }

        if (selectedAction === 'team_chat') {
          const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId(`admin_set_channel:channels.teamChats.${team}:${team}`)
              .setPlaceholder(`Choose ${teamLabel} Team Chat`)
              .setChannelTypes(ChannelType.GuildText)
              .setMinValues(1)
              .setMaxValues(1)
          );

          await interaction.update({
            content: `Select the channel to assign for **${teamLabel} Team Chat**.`,
            embeds: [],
            components: [row, createBackButtonRow(`admin_back_team_config:${team}`)]
          });
          return;
        }

        if (selectedAction === 'staff_room') {
          const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId(`admin_set_channel:channels.staffRooms.${team}:${team}`)
              .setPlaceholder(`Choose ${teamLabel} Staff Room`)
              .setChannelTypes(ChannelType.GuildText)
              .setMinValues(1)
              .setMaxValues(1)
          );

          await interaction.update({
            content: `Select the channel to assign for **${teamLabel} Staff Room**.`,
            embeds: [],
            components: [row, createBackButtonRow(`admin_back_team_config:${team}`)]
          });
          return;
        }

        if (selectedAction === 'private_category') {
          const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId(`admin_set_channel:channels.privateChatCategories.${team}:${team}`)
              .setPlaceholder(`Choose ${teamLabel} Absence Chat Category`)
              .setChannelTypes(ChannelType.GuildCategory)
              .setMinValues(1)
              .setMaxValues(1)
          );

          await interaction.update({
            content: `Select the category where **${teamLabel}** absence chats will be created.`,
            embeds: [],
            components: [row, createBackButtonRow(`admin_back_team_config:${team}`)]
          });
          return;
        }

        if (selectedAction === 'team_emojis') {
          const modal = new ModalBuilder()
            .setCustomId(`admin_set_team_emojis_modal:${team}`)
            .setTitle(`Set ${teamLabel} Emojis`);

          const emojiInput = new TextInputBuilder()
            .setCustomId('emoji')
            .setLabel('Team emoji, e.g. 🔵')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(getTeamMeta(config, team).emoji)
            .setMaxLength(40);

          const captainEmojiInput = new TextInputBuilder()
            .setCustomId('captain_emoji')
            .setLabel('Captain emoji, e.g. 🅒')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(config.teams?.[team]?.captainEmoji || '🅒')
            .setMaxLength(40);

          modal.addComponents(new ActionRowBuilder().addComponents(emojiInput), new ActionRowBuilder().addComponents(captainEmojiInput));
          await interaction.showModal(modal);
          return;
        }

        if (selectedAction === 'team_name') {
          const modal = new ModalBuilder()
            .setCustomId(`admin_set_team_name_modal:${team}`)
            .setTitle(`Set ${teamLabel} Name`);

          const nameInput = new TextInputBuilder()
            .setCustomId('team_name')
            .setLabel('Team display name')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(getTeamMeta(config, team).label || team)
            .setMaxLength(80);

          modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
          await interaction.showModal(modal);
          return;
        }

        if (selectedAction === 'event_name_phrases') {
          const modal = new ModalBuilder()
            .setCustomId(`admin_set_event_phrases_modal:${team}`)
            .setTitle(`Set ${teamLabel} Event Phrases`);

          const phrasesInput = new TextInputBuilder()
            .setCustomId('phrases')
            .setLabel('Comma-separated EXACT phrases')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setValue((config.teams?.[team]?.eventNamePhrases || []).join(', '))
            .setMaxLength(500);

          modal.addComponents(new ActionRowBuilder().addComponents(phrasesInput));
          await interaction.showModal(modal);
          return;
        }

        if (selectedAction === 'fixture_team') {
          const db = loadDb();
          const upcomingEvents = getUpcomingFixtures(db);

          if (!upcomingEvents.length) {
            await interaction.update({
              content: 'No upcoming fixtures found in synced events yet.',
              embeds: [],
              components: [createTeamConfigActionRow(config, team), createBackButtonRow('admin_back_team_management')]
            });
            return;
          }

          const pager = createFixturePagerRows(config, team, 0, upcomingEvents);

          await interaction.update({
            content: pager.text,
            embeds: [],
            components: pager.rows
          });
          return;
        }

        if (selectedAction === 'auto_assign_fixtures') {
          await interaction.deferUpdate();
          const db = loadDb();
          const teamMatchers = buildTeamMatchers(config);
          const assigned = [];

          for (const [eventId, event] of Object.entries(db.events || {})) {
            const normalizedTitle = String(event.title || '').toLowerCase();
            const matched = Object.entries(teamMatchers).find(([, phrases]) =>
              (phrases || []).some((phrase) => phrase && titleMatchesPhrase(normalizedTitle, phrase))
            );
            if (!matched) continue;

            const [matchedTeam] = matched;
            if (event.team !== matchedTeam) {
              db.events[eventId].team = matchedTeam;
              assigned.push({ eventId, title: event.title, date: event.date, team: matchedTeam });
            }
          }

          saveDb(db);
          await triggerGoogleSync(context);

          const preview = assigned
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .slice(0, 25);

          if (!preview.length) {
            await interaction.editReply({
              content: 'No fixtures changed from exact phrase matching. Update event phrases if needed.',
              embeds: [],
              components: [createTeamConfigActionRow(loadConfig(), team), createBackButtonRow('admin_back_team_management')]
            });
            return;
          }

          pendingFixtureCorrections.set(interaction.user.id, preview.map((item) => item.eventId));

          const correctionRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`admin_fixture_correction_dates:${team}`)
              .setPlaceholder('Select any wrong fixture dates (optional)')
              .setMinValues(0)
              .setMaxValues(preview.length)
              .addOptions(preview.map((item) => ({
                label: `${new Date(item.date).toLocaleDateString()} — ${item.title}`.slice(0, 100),
                value: item.eventId,
                description: `Assigned to ${getTeamMeta(config, item.team).label}`.slice(0, 100)
              })))
          );

          await interaction.editReply({
            content: [
              `✅ Auto-assigned ${assigned.length} fixture(s) by exact event-name phrase.`,
              'Review the list below. If any dates are wrong, select them next.'
            ].join('\n'),
            embeds: [],
            components: [correctionRow, createBackButtonRow(`admin_back_team_config:${team}`)]
          });
          return;
        }

        if (selectedAction === 'force_send_attendance') {
          await interaction.update({
            content: `Choose how far ahead to force-send attendance for **${teamLabel}**.`,
            embeds: [],
            components: [createForceAttendanceWindowRow(team), createBackButtonRow(`admin_back_team_config:${team}`)]
          });
          return;
        }
      }

      if (interaction.customId.startsWith('admin_player_action:')) {
        const selectedAction = interaction.values[0];
        const [, userId, mode = 'player'] = interaction.customId.split(':');
        await handleAdminPlayerAction(interaction, selectedAction, userId, mode);
        return;
      }

      if (interaction.customId.startsWith('admin_fixture_page:')) {
        const [, team, pageRaw] = interaction.customId.split(':');
        const page = Number.parseInt(pageRaw || '0', 10) || 0;
        const pager = createFixturePagerRows(loadConfig(), team, page, getUpcomingFixtures(loadDb()));
        await interaction.update({ content: pager.text, embeds: [], components: pager.rows });
        return;
      }

      if (interaction.customId.startsWith('admin_fixture_pick:')) {
        await interaction.deferUpdate();
        const [, team, eventId, pageRaw] = interaction.customId.split(':');
        const db = loadDb();
        const target = db.events[eventId];

        if (!target) {
          await interaction.editReply({
            content: 'Fixture was not found in synced events.',
            embeds: [],
            components: [createTeamConfigActionRow(config, team), createBackButtonRow('admin_back_team_management')]
          });
          return;
        }

        target.team = team;
        saveDb(db);
        await triggerGoogleSync(context);

        await interaction.editReply({
          content: `✅ Assigned **${target.title}** to **${getTeamMeta(config, team).label}**.`,
          embeds: [],
          components: createFixturePagerRows(loadConfig(), team, Number.parseInt(pageRaw || '0', 10) || 0, getUpcomingFixtures(loadDb())).rows
        });
        return;
      }

      if (interaction.customId.startsWith('admin_player_set_teams:')) {
        const userId = interaction.customId.split(':')[1];
      const mode = interaction.customId.split(':')[2] || 'player';
      const existingProfile = getPlayerProfile(userId) || {};
      const selectedTeams = interaction.values;
      if (mode !== 'coach') {
        const blocked = selectedTeams.find((teamKey) => !teamAllowsGender(loadConfig().teams?.[teamKey]?.gender, existingProfile.gender));
        if (blocked) {
          const label = getTeamMeta(loadConfig(), blocked).label;
          await interaction.update({
            content: `❌ ${getGenderMismatchMessage(label, loadConfig().teams?.[blocked]?.gender)} Set player gender to match or pick a different team.`,
            embeds: [],
            components: [createPlayerProfileActionRow(userId, mode), createPlayerProfileActionRow2(userId, mode), createBackButtonRow('admin_back_player_management')]
          });
          return;
        }
      }
      const profile = upsertPlayerProfile(userId, mode === 'coach'
        ? { coachTeams: selectedTeams }
        : { teams: selectedTeams });
      const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
      const targetUser = targetMember?.user || await interaction.client.users.fetch(userId).catch(() => null);
      if (targetMember) {
        const latestConfig = loadConfig();
        const allTeams = Object.keys(latestConfig.teams || {});
        const configuredRoleIds = allTeams
          .map((teamKey) => mode === 'coach' ? latestConfig.roles?.[teamKey]?.coach : latestConfig.roles?.[teamKey]?.player)
          .filter((roleId) => roleId && roleId !== 'ROLE_ID');
        for (const roleId of configuredRoleIds) {
          const teamForRole = allTeams.find((teamKey) => (mode === 'coach' ? latestConfig.roles?.[teamKey]?.coach : latestConfig.roles?.[teamKey]?.player) === roleId);
          const shouldHave = teamForRole && selectedTeams.includes(teamForRole);
          if (shouldHave && !targetMember.roles.cache.has(roleId)) await targetMember.roles.add(roleId).catch(() => null);
          if (!shouldHave && targetMember.roles.cache.has(roleId)) await targetMember.roles.remove(roleId).catch(() => null);
        }
      }
      await interaction.update({
        ...buildPlayerProfileView(loadConfig(), interaction.guild, targetUser, targetMember, profile, mode),
        components: [createPlayerProfileActionRow(userId, mode), createPlayerProfileActionRow2(userId, mode), createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')]
      });
      await triggerGoogleSync(context);
      return;
      }

      if (interaction.customId.startsWith('admin_player_shirt_team:')) {
        const [, userId, mode = 'player'] = interaction.customId.split(':');
        const team = interaction.values[0];
        const profile = getPlayerProfile(userId) || {};
        const modal = new ModalBuilder()
          .setCustomId(`admin_player_shirt_modal:${userId}:${mode}:${team}`)
          .setTitle(`Set ${getTeamMeta(loadConfig(), team).label} Shirt #`);
        const current = getShirtForTeam(profile, team);
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('shirt_number')
            .setLabel('Shirt number')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setValue(String(current || ''))
            .setMaxLength(6)
        ));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId.startsWith('admin_coach_position_team:')) {
        const [, userId, mode = 'player'] = interaction.customId.split(':');
        const team = interaction.values[0];
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`admin_coach_position_value:${userId}:${mode}:${team}`)
            .setPlaceholder(`Set ${getTeamMeta(loadConfig(), team).label} coach position`)
            .addOptions([
              { label: 'Head Coach', value: 'head_coach', description: 'Displayed as Head Coach Name' },
              { label: 'Assistant Coach', value: 'assistant_coach', description: 'Displayed as Assistant Coach Name' },
              { label: 'Goal Keeping Coach', value: 'goalkeeping_coach', description: 'Displayed as Goal Keeping Coach Name' },
              { label: 'Coach', value: 'coach', description: 'Displayed as Coach Name' }
            ])
        );
        await interaction.update({ content: 'Choose coach position for this team.', embeds: [], components: [row, createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')] });
        return;
      }

      if (interaction.customId.startsWith('admin_coach_position_value:')) {
        const [, userId, mode = 'player', team] = interaction.customId.split(':');
        const value = interaction.values[0];
        const profile = getPlayerProfile(userId) || {};
        const coachPositions = { ...(profile.coachPositions || {}), [team]: value };
        const updated = upsertPlayerProfile(userId, { coachPositions });
        await interaction.update({
          content: getCoachManagementSummary(),
          embeds: [],
          components: [createCoachManagementRow(loadConfig(), interaction.guild), createAdminBackButtonRow()]
        });
        return;
      }

      if (interaction.customId.startsWith('admin_player_set_gender:')) {
        const [, userId, mode = 'player', selected] = interaction.customId.split(':');
        const genderValue = selected === 'clear' ? '' : selected;
        const updated = upsertPlayerProfile(userId, { gender: genderValue });
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        const user = member?.user || await interaction.client.users.fetch(userId).catch(() => null);
        await interaction.update({
          ...buildPlayerProfileView(loadConfig(), interaction.guild, user, member, updated, mode),
          components: [createPlayerProfileActionRow(userId, mode), createPlayerProfileActionRow2(userId, mode), createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')]
        });
        return;
      }

      if (interaction.customId.startsWith('admin_set_team_gender:')) {
        const team = interaction.customId.split(':')[1];
        const gender = interaction.values[0];
        updateConfig(`teams.${team}.gender`, gender);
        await interaction.update({
          content: `✅ Updated **${getTeamMeta(loadConfig(), team).label}** gender to **${gender}**.`,
          embeds: [],
          components: [createTeamConfigActionRow(loadConfig(), team), createBackButtonRow('admin_back_team_management')]
        });
        return;
      }

      if (interaction.customId.startsWith('admin_force_attendance_window:')) {
        await interaction.deferUpdate();
        const team = interaction.customId.split(':')[1];
        const window = interaction.values[0];
        const latestConfig = loadConfig();
        const db = loadDb();
        const remoteEvents = await fetchCalendarEvents({
          calendarId: latestConfig.bot.calendarId,
          daysAhead: null,
          credentialsPath: latestConfig.bot.calendarCredentialsPath || '',
          teamMatchers: buildTeamMatchers(latestConfig)
        });

        for (const event of remoteEvents) {
          const existing = db.events[event.id] || {};
          db.events[event.id] = {
            ...existing,
            title: event.title,
            date: event.date,
            location: event.location || existing.location || '',
            team: event.team || existing.team || team,
            discordMessageId: existing.discordMessageId || '',
            responses: existing.responses || {},
            updatedAt: new Date().toISOString()
          };
        }
        saveDb(db);

        const now = Date.now();
        const maxDays = window === 'next_event' ? 365 : (window === 'next_30_days' ? 30 : 14);
        const candidates = Object.entries(db.events || {})
          .map(([id, event]) => ({ id, ...event }))
          .filter((event) => event.team === team && new Date(event.date).getTime() >= now && !event.discordMessageId)
          .filter((event) => (new Date(event.date).getTime() - now) <= (maxDays * 24 * 60 * 60 * 1000))
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        const targets = window === 'next_event' ? candidates.slice(0, 1) : candidates;
        let sent = 0;

        for (const event of targets) {
          try {
            await postAttendancePromptForEvent(interaction, event, latestConfig);
            sent += 1;
          } catch (error) {
            await context.sendLog(`⚠️ Failed force-send for ${event.title}: ${error.message}`);
          }
        }

        await interaction.editReply({
          content: `✅ Force-send complete for **${getTeamMeta(latestConfig, team).label}**. Sent ${sent}/${targets.length} attendance prompt(s).`,
          embeds: [],
          components: [createTeamConfigActionRow(latestConfig, team), createBackButtonRow('admin_back_team_management')]
        });
        return;
      }

      if (interaction.customId.startsWith('admin_fixture_correction_dates:')) {
        const team = interaction.customId.split(':')[1];
        const selectedEventIds = interaction.values;
        pendingFixtureCorrections.set(interaction.user.id, selectedEventIds);

        const row = createTeamPickerRow(loadConfig(), `admin_fixture_correction_team:${team}`, 'Pick the team for selected dates');
        await interaction.update({
          content: 'Select which team the chosen wrong dates should belong to.',
          embeds: [],
          components: [row, createBackButtonRow(`admin_back_team_config:${team}`)]
        });
        return;
      }

      if (interaction.customId.startsWith('admin_fixture_correction_team:')) {
        const sourceTeam = interaction.customId.split(':')[1];
        const destinationTeam = interaction.values[0];
        const eventIds = pendingFixtureCorrections.get(interaction.user.id) || [];
        const db = loadDb();

        for (const eventId of eventIds) {
          if (db.events[eventId]) db.events[eventId].team = destinationTeam;
        }
        saveDb(db);
        pendingFixtureCorrections.delete(interaction.user.id);
        await triggerGoogleSync(context);

        await interaction.update({
          content: `✅ Reassigned ${eventIds.length} selected fixture date(s) to **${getTeamMeta(loadConfig(), destinationTeam).label}**.`,
          embeds: [],
          components: [createTeamConfigActionRow(loadConfig(), sourceTeam), createBackButtonRow('admin_back_team_management')]
        });
        return;
      }
    }

    if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('admin_set_role:')) {
      if (!hasAdminAccess(interaction.member, config)) {
        await denyAdminAccess();
        return;
      }
      await interaction.deferUpdate();
      const [, configPath, team] = interaction.customId.split(':');
      const roleId = interaction.values[0];
      await setProgressReply(interaction, 0, 'Updating role setting...');
      updateConfig(configPath, roleId);
      await setProgressReply(interaction, 40, 'Saving role ID...');
      await logAdminUiAction(interaction, 'admin-config', 'set', { field: configPath, value: roleId });
      await setProgressReply(interaction, 70, 'Syncing configuration...');

      try {
        await syncConfigSnapshotIfEnabled();
      } catch (error) {
        await interaction.editReply({
          content: `✅ Updated **${configPath}** to <@&${roleId}>. ⚠️ Sync warning: ${error.message}`,
          embeds: [],
          components: [createTeamConfigActionRow(loadConfig(), team), createBackButtonRow('admin_back_team_management')]
        });
        return;
      }

      await interaction.editReply({
        content: `${renderProgressMessage(100, `Updated ${configPath} to <@&${roleId}>.`)}\n\n${getTeamConfigSummary(loadConfig(), interaction.guild, team)}`,
        embeds: [],
        components: [createTeamConfigActionRow(loadConfig(), team), createBackButtonRow('admin_back_team_management')]
      });
      return;
    }

    if (interaction.isUserSelectMenu() && ['admin_player_select', 'admin_coach_select'].includes(interaction.customId)) {
      if (!hasAdminAccess(interaction.member, config)) {
        await denyAdminAccess();
        return;
      }
      const mode = interaction.customId === 'admin_coach_select' ? 'coach' : 'player';
      const userId = interaction.values[0];
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      const user = member?.user || await interaction.client.users.fetch(userId).catch(() => null);
      const existing = getPlayerProfile(userId) || {};
      const inferredPlayerTeams = Object.keys(loadConfig().roles || {}).filter((teamKey) => {
        const roleId = loadConfig().roles?.[teamKey]?.player;
        return roleId && roleId !== 'ROLE_ID' && member?.roles?.cache?.has(roleId);
      });
      const inferredCoachTeams = Object.keys(loadConfig().roles || {}).filter((teamKey) => {
        const roleId = loadConfig().roles?.[teamKey]?.coach;
        return roleId && roleId !== 'ROLE_ID' && member?.roles?.cache?.has(roleId);
      });
      const seeded = upsertPlayerProfile(userId, {
        userId,
        customName: existing.customName || '',
        shirtNumber: existing.shirtNumber || '',
        teams: Array.from(new Set([...(existing.teams || []), ...inferredPlayerTeams])),
        coachTeams: Array.from(new Set([...(existing.coachTeams || []), ...inferredCoachTeams])),
        roles: existing.roles || (member ? Array.from(member.roles.cache.keys()).filter((id) => id !== interaction.guild.id) : []),
        joinedDiscordAt: existing.joinedDiscordAt || (member?.joinedAt ? member.joinedAt.toISOString().slice(0, 10) : ''),
        faceImageUrl: existing.faceImageUrl || existing.facePngUrl || '',
        facePngUrl: existing.faceImageUrl || existing.facePngUrl || '',
        notes: existing.notes || ''
      });

      await interaction.update({
        ...buildPlayerProfileView(loadConfig(), interaction.guild, user, member, seeded, mode),
        components: [createPlayerProfileActionRow(userId, mode), createPlayerProfileActionRow2(userId, mode), createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')]
      });
      await triggerGoogleSync(context);
      return;
    }

    if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('admin_player_assign_roles:')) {
      if (!hasAdminAccess(interaction.member, config)) {
        await denyAdminAccess();
        return;
      }
      const userId = interaction.customId.split(':')[1];
      const mode = interaction.customId.split(':')[2] || 'player';
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      if (member) {
        for (const roleId of interaction.values) {
          if (member.roles.cache.has(roleId)) await member.roles.remove(roleId).catch(() => null);
          else await member.roles.add(roleId).catch(() => null);
        }
      }
      const profile = upsertPlayerProfile(userId, { roles: member ? Array.from(member.roles.cache.keys()).filter((id) => id !== interaction.guild.id) : interaction.values });
      await interaction.update({
        ...buildPlayerProfileView(loadConfig(), interaction.guild, member?.user, member, profile, mode),
        components: [createPlayerProfileActionRow(userId, mode), createPlayerProfileActionRow2(userId, mode), createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')]
      });
      await triggerGoogleSync(context);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('admin_player_note_toggle:')) {
      const [, userId, mode = 'player', operation = 'hide'] = interaction.customId.split(':');
      const canAdmin = hasAdminAccess(interaction.member, config);
      if (!canAdmin) {
        await interaction.reply({ content: 'Only admins can hide or restore notes.', flags: MessageFlags.Ephemeral });
        return;
      }
      const profile = getPlayerProfile(userId) || {};
      const selectedNoteId = interaction.values[0];
      const updatedNotes = getProfileNotes(profile).map((note) => note.id === selectedNoteId
        ? { ...note, hidden: operation === 'hide', updatedAt: new Date().toISOString(), updatedBy: interaction.user.id, updatedByTag: interaction.user.tag }
        : note);
      const updatedProfile = upsertPlayerProfile(userId, { ...profile, notesLog: updatedNotes });
      await triggerGoogleSync(context);
      const visibleNotes = getProfileNotes(updatedProfile).filter((note) => !note.hidden);
      await interaction.update({
        content: [
          `Notes for <@${userId}> (${mode} profile):`,
          visibleNotes.length
            ? visibleNotes.map((note, idx) => `${idx + 1}. [${new Date(note.createdAt).toISOString().slice(0, 10)}] ${note.authorTag || note.authorId || 'unknown'} — ${note.text}`).join('\n')
            : '*No visible notes yet.*'
        ].join('\n'),
        embeds: [],
        components: createPlayerNotesActionRows(userId, mode, true, updatedProfile)
      });
      return;
    }

    if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('admin_set_channel:')) {
      if (!hasAdminAccess(interaction.member, config)) {
        await denyAdminAccess();
        return;
      }
      await interaction.deferUpdate();
      const [, configPath, team] = interaction.customId.split(':');
      const channelId = interaction.values[0];
      const currentConfig = loadConfig();
      const currentValue = configPath.split('.').reduce((acc, key) => (acc ? acc[key] : undefined), currentConfig);
      if (String(currentValue || '') === String(channelId || '')) {
        await interaction.editReply({
          content: `${renderProgressMessage(100, `Channel already set to <#${channelId}>. No changes needed.`)}`,
          embeds: [],
          components: team === 'global'
            ? [createClubManagementRow(), createClubManagementRow2()]
            : [createTeamConfigActionRow(loadConfig(), team), createBackButtonRow('admin_back_team_management')]
        });
        return;
      }
      await setProgressReply(interaction, 0, 'Updating channel setting...');
      updateConfig(configPath, channelId);
      await setProgressReply(interaction, 40, 'Saving channel ID...');
      await logAdminUiAction(interaction, 'admin-config', 'set', { field: configPath, value: channelId });
      await setProgressReply(interaction, 70, 'Syncing configuration...');

      try {
        await syncConfigSnapshotIfEnabled();
      } catch (error) {
        await interaction.editReply({
          content: `✅ Updated **${configPath}** to <#${channelId}>. ⚠️ Sync warning: ${error.message}`,
          embeds: [],
          components: team === 'global'
            ? [createClubManagementRow(), createClubManagementRow2()]
            : [createTeamConfigActionRow(loadConfig(), team), createBackButtonRow('admin_back_team_management')]
        });
        return;
      }

      await interaction.editReply({
        content: `${renderProgressMessage(100, `Updated ${configPath} to <#${channelId}>.`)}${team === 'global' ? '' : `\n\n${getTeamConfigSummary(loadConfig(), interaction.guild, team)}`}`,
        embeds: [],
        components: team === 'global'
          ? [createClubManagementRow(), createClubManagementRow2()]
          : [createTeamConfigActionRow(loadConfig(), team), createBackButtonRow('admin_back_team_management')]
      });

      if (team === 'global' && configPath === 'channels.botCommands') {
        const commandChannel = interaction.guild?.channels?.cache?.get(channelId);
        if (commandChannel?.isTextBased()) {
          await commandChannel.send(
            '🔥 Firelands-Bot is now configured for this channel.\nPlayers can use **/player** and coaches can use **/coach** to open their bot UI.'
          ).catch(() => null);
        }
      }
      return;
    }

    if (interaction.isModalSubmit() && (interaction.customId.startsWith('absence_reason:') || interaction.customId.startsWith('absence_reason_token:'))) {
      const parts = interaction.customId.split(':');
      const eventId = interaction.customId.startsWith('absence_reason_token:')
        ? pendingAbsenceReasonModals.get(parts.slice(1).join(':'))
        : parts[1];
      const db = loadDb();
      const event = db.events[eventId];

      if (!event) {
        await interaction.reply({ content: 'Event no longer exists.', flags: MessageFlags.Ephemeral });
        return;
      }

      const teamRoles = teamRolesMap[event.team];
      if (!hasRole(interaction.member, teamRoles.player) && !hasRole(interaction.member, teamRoles.coach)) {
        await interaction.reply({ content: 'Only players/coaches for this team can respond.', flags: MessageFlags.Ephemeral });
        return;
      }

      const reason = interaction.fields.getTextInputValue('reason').trim();
      if (interaction.customId.startsWith('absence_reason_token:')) {
        pendingAbsenceReasonModals.delete(parts.slice(1).join(':'));
      }
      const profile = getPlayerProfile(interaction.user.id);
      const requiredGender = config.teams?.[event.team]?.gender;
      if (!teamAllowsGender(requiredGender, profile?.gender)) {
        await interaction.reply({ content: getGenderMismatchMessage(getTeamMeta(config, event.team).label, requiredGender), flags: MessageFlags.Ephemeral });
        return;
      }
      const playerDisplayName = buildRichPlayerMention(config, interaction.user, interaction.member, profile, event.team);

      setResponse(eventId, interaction.user.id, {
        status: 'pending_no',
        reason,
        confirmed: false,
        responderType: hasRole(interaction.member, teamRoles.coach) && !hasRole(interaction.member, teamRoles.player) ? 'coach' : 'player',
        username: playerDisplayName,
        updatedAt: new Date().toISOString()
      });
      await interaction.reply({
        content: [
          `${playerDisplayName}, your absence for:`,
          `📅 ${event.title}`,
          `🕒 ${new Date(event.date).toLocaleString()}`,
          ':exclamation: The reason why:',
          reason,
          'is pending coach confirmation.'
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
      await triggerGoogleSync(context);

      const eventDateLabel = getCompactDateLabel(event.date);
      const channelName = buildAbsenceTicketChannelName(config, event, profile, interaction.member, interaction.user);

      let ticketChannel;
      try {
        ticketChannel = await interaction.guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: config.channels.privateChatCategories?.[event.team] || config.channels.ticket || null,
          permissionOverwrites: [
            {
              id: interaction.guild.id,
              deny: [PermissionFlagsBits.ViewChannel]
            },
            {
              id: interaction.client.user.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels]
            },
            {
              id: interaction.user.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
            },
            {
              id: teamRoles.coach,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
            }
          ]
        });
      } catch (error) {
        console.error('Failed to create ticket channel:', error);
      }

      if (ticketChannel) {
        const ticketUrl = `https://discord.com/channels/${interaction.guild.id}/${ticketChannel.id}`;
        setAbsenceTicket(ticketChannel.id, {
          ticketId: ticketChannel.id,
          eventId,
          playerId: interaction.user.id,
          playerName: playerDisplayName,
          team: event.team,
          reason,
          status: 'open',
          chatLog: [],
          createdBy: interaction.user.id,
          createdAt: new Date().toISOString()
        });

        await interaction.user.send({
          content: [
            `🧾 Your absence ticket was created for **${event.title}**.`,
            `📅 ${eventDateLabel}`,
            `📝 Reason: ${reason}`,
            `🔗 Open ticket: ${ticketUrl}`
          ].join('\n')
        }).catch(() => null);

        await ticketChannel.send({
          content: [
            `🧾 Absence ticket for <@${interaction.user.id}>`,
            `📅 ${eventDateLabel} — ${event.title}`,
            `📝 Reason: ${reason}`,
            '',
            'Staff/coaches: confirm or decline this absence request below.'
          ].join('\n'),
          components: [createAbsenceTicketDecisionRow()]
        });

        const staffRoomId = config.channels.staffRooms?.[event.team];
        let staffNotification;
        let adminNotification;
        if (staffRoomId) {
          const staffRoom = await interaction.guild.channels.fetch(staffRoomId).catch(() => null);
          if (staffRoom?.isTextBased()) {
            const staffMessage = await staffRoom.send({
              content: formatAbsenceNotification({
                playerId: interaction.user.id,
                playerName: playerDisplayName
              }, event, 'open'),
              components: [createAbsenceNotificationRow(ticketChannel.id, interaction.user.id, 'coach')]
            }).catch(() => null);
            if (staffMessage) {
              staffNotification = { channelId: staffRoom.id, messageId: staffMessage.id, mode: 'coach' };
            }
          }
        }
        if (config.channels?.admin) {
          const adminChannel = await interaction.guild.channels.fetch(config.channels.admin).catch(() => null);
          if (adminChannel?.isTextBased()) {
            const adminMessage = await adminChannel.send({
              content: formatAbsenceNotification({
                playerId: interaction.user.id,
                playerName: playerDisplayName
              }, event, 'open'),
              components: [createAbsenceNotificationRow(ticketChannel.id, interaction.user.id, 'admin')]
            }).catch(() => null);
            if (adminMessage) {
              adminNotification = { channelId: adminChannel.id, messageId: adminMessage.id, mode: 'admin' };
            }
          }
        }
        if (staffNotification || adminNotification) {
          setAbsenceTicket(ticketChannel.id, { staffNotification, adminNotification });
        }

        await context.sendLog(
          `🔴 ${playerDisplayName} submitted not-attending for **${event.title}** (${eventDateLabel}). Reason: ${reason}\nTicket: <#${ticketChannel.id}>`
        );
      }

      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('admin_event_type_exact_modal:')) {
      if (!hasAdminAccess(interaction.member, config)) {
        await denyAdminAccess();
        return;
      }
      const action = interaction.customId.split(':')[1];
      const names = interaction.fields.getTextInputValue('exact_names')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (action === 'set_practice_exact') updateConfig('eventTypes.practiceExactNames', names);
      if (action === 'set_match_exact') updateConfig('eventTypes.matchExactNames', names);
      if (action === 'set_other_exact') updateConfig('eventTypes.otherExactNames', names);

      const rules = getEventTypeConfig(loadConfig());
      await interaction.reply({
        content: [
          '✅ Event type exact-name rules updated.',
          `• Practice: ${rules.practiceExactNames.join(', ') || 'none'}`,
          `• Match: ${rules.matchExactNames.join(', ') || 'none'}`,
          `• Other: ${rules.otherExactNames.join(', ') || 'none'}`
        ].join('\n'),
        components: [createEventTypeRulesRow(), createEventTypeRulesRow2()],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'admin_set_calendar_modal') {
      if (!hasAdminAccess(interaction.member, config)) {
        await denyAdminAccess();
        return;
      }
      const calendarId = interaction.fields.getTextInputValue('calendar_id').trim();

      if (!calendarId) {
        await interaction.reply({ content: 'Calendar ID cannot be empty.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply({ content: renderProgressMessage(0, 'Updating calendar setting...') });
      updateConfig('bot.calendarId', calendarId);
      await interaction.editReply({ content: renderProgressMessage(40, 'Saving calendar ID...') });
      await logAdminUiAction(interaction, 'admin', 'set-calendar-id', { calendarId });
      await interaction.editReply({ content: renderProgressMessage(70, 'Syncing configuration...') });
      try {
        await syncConfigSnapshotIfEnabled();
      } catch (error) {
        await interaction.editReply({ content: `✅ Updated **bot.calendarId** to \`${calendarId}\`. ⚠️ Sync warning: ${error.message}` });
        return;
      }
      await interaction.editReply({ content: renderProgressMessage(100, `Updated **bot.calendarId** to \`${calendarId}\`.`) });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('admin_player_note_modal:add:')) {
      const [, , userId, mode = 'player'] = interaction.customId.split(':');
      const noteText = interaction.fields.getTextInputValue('note_text').trim();
      if (!noteText) {
        await interaction.reply({ content: 'Note cannot be empty.', flags: MessageFlags.Ephemeral });
        return;
      }

      const existing = getPlayerProfile(userId) || {};
      const notes = getProfileNotes(existing);
      const note = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        text: noteText,
        hidden: false,
        profileType: mode,
        createdAt: new Date().toISOString(),
        authorId: interaction.user.id,
        authorTag: interaction.user.tag
      };
      const updatedProfile = upsertPlayerProfile(userId, { ...existing, notesLog: [...notes, note] });
      await triggerGoogleSync(context);
      const canAdmin = hasAdminAccess(interaction.member, config);
      const visibleNotes = getProfileNotes(updatedProfile).filter((entry) => !entry.hidden);
      await interaction.reply({
        content: [
          `Notes for <@${userId}> (${mode} profile):`,
          visibleNotes.length
            ? visibleNotes.map((entry, idx) => `${idx + 1}. [${new Date(entry.createdAt).toISOString().slice(0, 10)}] ${entry.authorTag || entry.authorId || 'unknown'} — ${entry.text}`).join('\n')
            : '*No visible notes yet.*',
          canAdmin ? '' : '_Hidden notes are admin-only._'
        ].join('\n'),
        embeds: [],
        components: createPlayerNotesActionRows(userId, mode, canAdmin, updatedProfile),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('admin_player_shirt_modal:')) {
      if (!hasAdminAccess(interaction.member, config)) {
        await denyAdminAccess();
        return;
      }
      const [, userId, mode = 'player', team] = interaction.customId.split(':');
      const shirtNumber = interaction.fields.getTextInputValue('shirt_number').trim();
      const profile = getPlayerProfile(userId) || {};
      const shirtNumbers = { ...(profile.shirtNumbers || {}) };
      if (shirtNumber) shirtNumbers[team] = shirtNumber;
      else delete shirtNumbers[team];
      const updated = upsertPlayerProfile(userId, { shirtNumbers });
      await interaction.reply({
        content: mode === 'coach' ? getCoachManagementSummary() : getPlayerManagementSummary(),
        embeds: [],
        components: mode === 'coach'
          ? [createCoachManagementRow(loadConfig(), interaction.guild), createAdminBackButtonRow()]
          : [...createPlayerManagementRows('player', interaction.guild, 0), createAdminBackButtonRow()],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('admin_player_profile_modal:')) {
      if (!hasAdminAccess(interaction.member, config)) {
        await denyAdminAccess();
        return;
      }
      const [, action, userId, mode = 'player'] = interaction.customId.split(':');
      const updates = {};
      await interaction.deferUpdate();
      await interaction.editReply({
        content: renderProgressMessage(35, 'Updating player profile...'),
        embeds: [],
        components: []
      });

      if (action === 'set_name') updates.customName = interaction.fields.getTextInputValue('custom_name').trim();
      if (action === 'set_nickname') updates.nickName = interaction.fields.getTextInputValue('nickname').trim();
      if (action === 'set_face') {
        const faceImageUrl = interaction.fields.getTextInputValue('face_image_url').trim();
        if (faceImageUrl && !/^https?:\/\/\S+\.(png|webp|jpe?g)(?:\?\S*)?$/i.test(faceImageUrl)) {
          await interaction.editReply({ content: 'Face URL must be a direct image link ending in .png, .webp, .jpg, or .jpeg.', components: [createPlayerProfileActionRow(userId, mode), createPlayerProfileActionRow2(userId, mode), createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')] });
          return;
        }
        updates.faceImageUrl = faceImageUrl;
        updates.facePngUrl = faceImageUrl;
      }
      if (action === 'set_shirt') updates.shirtNumber = interaction.fields.getTextInputValue('shirt_number').trim();
      if (action === 'set_gender') {
        const gender = interaction.fields.getTextInputValue('gender').trim().toLowerCase();
        if (gender && !['male', 'female'].includes(gender)) {
          await interaction.editReply({ content: 'Gender must be `male` or `female`.', components: [createPlayerProfileActionRow(userId, mode), createPlayerProfileActionRow2(userId, mode), createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')] });
          return;
        }
        updates.gender = gender;
      }
      if (action === 'set_notes') updates.notes = interaction.fields.getTextInputValue('notes').trim();

      const profile = upsertPlayerProfile(userId, updates);
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      const user = member?.user || await interaction.client.users.fetch(userId).catch(() => null);
      await triggerGoogleSync(context);

      await interaction.editReply({
        ...buildPlayerProfileView(loadConfig(), interaction.guild, user, member, profile, mode),
        components: [createPlayerProfileActionRow(userId, mode), createPlayerProfileActionRow2(userId, mode), createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')],
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('admin_set_team_emojis_modal:')) {
      if (!hasAdminAccess(interaction.member, config)) {
        await denyAdminAccess();
        return;
      }
      const team = interaction.customId.split(':')[1];
      const emoji = interaction.fields.getTextInputValue('emoji').trim();
      const captainEmoji = interaction.fields.getTextInputValue('captain_emoji').trim() || '🅒';

      if (!config.teams?.[team]) {
        await interaction.reply({ content: 'Team key was not found in configuration.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply({ content: renderProgressMessage(0, 'Updating team emoji...') });
      await logAdminUiAction(interaction, 'admin', 'set-emoji', { team, emoji });
      updateConfig(`teams.${team}.emoji`, emoji.trim());
      updateConfig(`teams.${team}.captainEmoji`, captainEmoji);
      await interaction.editReply({ content: renderProgressMessage(40, 'Saving emoji settings...') });
      try {
        await interaction.editReply({ content: renderProgressMessage(70, 'Syncing configuration...') });
        await syncConfigSnapshotIfEnabled();
      } catch (error) {
        await interaction.editReply({ content: `✅ Team label updated. ⚠️ Sync warning: ${error.message}` });
        return;
      }
      await interaction.editReply({ content: renderProgressMessage(100, `Team/captain emojis updated for **${getTeamMeta(loadConfig(), team).label}**.`) });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('admin_location_alias_modal:')) {
      if (!hasAdminAccess(interaction.member, config)) {
        await denyAdminAccess();
        return;
      }

      const token = interaction.customId.split(':')[1];
      const [picked] = pendingLocationAliasSelections.get(token) || [];
      pendingLocationAliasSelections.delete(token);
      if (!picked) {
        await interaction.reply({ content: 'Address selection expired. Please try again.', flags: MessageFlags.Ephemeral });
        return;
      }

      const nickname = interaction.fields.getTextInputValue('location_nickname').trim();
      const latestConfig = loadConfig();
      const aliases = { ...(latestConfig.googleSync?.locationAliases || {}) };
      const aliasKey = encodeAliasKey(picked.eventType, picked.location);
      if (nickname) aliases[aliasKey] = nickname;
      else delete aliases[aliasKey];

      updateConfig('googleSync.locationAliases', aliases);
      await syncConfigSnapshotIfEnabled().catch(() => null);

      await interaction.reply({
        content: [
          `✅ Saved nickname for (${eventTypeLabel(picked.eventType)}) address.`,
          `Address: [${picked.location}](${getMapsLink(picked.location)})`,
          `Nickname: ${nickname || 'cleared (using full address)'}`
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'admin_sheet_backup_create_modal') {
      if (!hasAdminAccess(interaction.member, config)) {
        await denyAdminAccess();
        return;
      }
      const name = interaction.fields.getTextInputValue('backup_name').trim();
      if (!name) {
        await interaction.reply({ content: 'Backup name is required.', flags: MessageFlags.Ephemeral });
        return;
      }
      const backups = await loadSheetBackups(loadConfig()).catch(() => []);
      const used = new Set(backups.map((entry) => entry.slot));
      const freeSlot = [1, 2, 3, 4, 5].find((slot) => !used.has(slot));
      const summary = `events:${Object.keys(loadDb().events || {}).length}, players:${Object.keys(loadDb().players || {}).length}`;
      const configForBackup = loadConfig();

      if (freeSlot) {
        await interaction.reply({
          content: progressLines({ title: `💾 Saving backup **${name}** to slot ${freeSlot}`, percent: 0, etaMs: 0, currentTab: '', tabs: [] }),
          flags: MessageFlags.Ephemeral
        });
        const progressState = { percent: 0, etaMs: 0, currentTab: '', tabs: [] };
        let lastProgressEdit = 0;
        const built = await buildSpreadsheetBackupSnapshot(configForBackup, (progress) => {
          progressState.percent = progress.percent;
          progressState.etaMs = progress.etaMs;
          progressState.currentTab = progress.currentTab;
          progressState.tabs = progress.tabs || [];
          const now = Date.now();
          if (now - lastProgressEdit >= 600) {
            lastProgressEdit = now;
            interaction.editReply({
              content: progressLines({
                title: `💾 Saving backup **${name}** to slot ${freeSlot}`,
                ...progressState
              })
            }).catch(() => null);
          }
        });
        if (!built.ok) {
          await interaction.editReply({ content: 'Could not save backup: spreadsheet ID is missing.' });
          return;
        }

        await interaction.editReply({
          content: progressLines({
            title: `💾 Saving backup **${name}** to slot ${freeSlot}`,
            percent: 95,
            etaMs: 0,
            currentTab: 'Writing backup row',
            tabs: progressState.tabs
          })
        });
        try {
          await Promise.race([
            saveSheetBackupSlot(configForBackup, {
              slot: freeSlot,
              name,
              createdBy: `${interaction.user.tag}`,
              summary,
              snapshot: JSON.stringify(built.snapshot)
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Backup write timed out after 90 seconds. Please try again.')), 90_000))
          ]);
        } catch (error) {
          await interaction.editReply({
            content: [
              `❌ Could not save backup **${name}**.`,
              `Reason: ${error.message}`
            ].join('\n')
          });
          return;
        }
        await interaction.editReply({
          content: progressLines({
            title: `✅ Saved backup **${name}** in slot ${freeSlot}`,
            percent: 100,
            etaMs: 0,
            currentTab: progressState.currentTab,
            tabs: progressState.tabs
          })
        });
        return;
      }

      const token = Math.random().toString(36).slice(2, 12);
      pendingSheetBackupWrites.set(token, { name, summary });
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`admin_sheet_backup_overwrite_pick:${token}`)
          .setPlaceholder('Pick slot to overwrite (5/5 used)')
          .addOptions(backups
            .sort((a, b) => a.slot - b.slot)
            .map((entry) => ({
              label: `Slot ${entry.slot} • ${entry.name || `Backup ${entry.slot}`}`.slice(0, 100),
              value: String(entry.slot),
              description: (entry.createdAt || 'unknown').slice(0, 100)
            })))
      );
      await interaction.reply({ content: 'Backups are full (5/5). Choose which slot to overwrite.', components: [row], flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('admin_set_team_name_modal:')) {
      if (!hasAdminAccess(interaction.member, config)) {
        await denyAdminAccess();
        return;
      }
      const team = interaction.customId.split(':')[1];
      const teamName = interaction.fields.getTextInputValue('team_name').trim();

      if (!teamName) {
        await interaction.reply({ content: 'Team name cannot be empty.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply({ content: renderProgressMessage(0, 'Updating team name...') });
      updateConfig(`teams.${team}.label`, teamName);
      await interaction.editReply({ content: renderProgressMessage(40, 'Saving team label...') });
      await logAdminUiAction(interaction, 'admin', 'set-team-name', { team, teamName });

      try {
        await interaction.editReply({ content: renderProgressMessage(70, 'Syncing configuration...') });
        await syncConfigSnapshotIfEnabled();
      } catch (error) {
        await interaction.editReply({ content: `✅ Team name updated. ⚠️ Sync warning: ${error.message}` });
        return;
      }

      const latestConfig = loadConfig();
      await interaction.editReply({
        content: `${renderProgressMessage(100, `Team name updated to **${teamName}**.`)}\n\n${getTeamConfigSummary(latestConfig, interaction.guild, team)}`,
        components: [createTeamConfigActionRow(latestConfig, team), createBackButtonRow(`admin_back_team_config:${team}`)]
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('admin_set_event_phrases_modal:')) {
      if (!hasAdminAccess(interaction.member, config)) {
        await denyAdminAccess();
        return;
      }
      const team = interaction.customId.split(':')[1];
      const raw = interaction.fields.getTextInputValue('phrases');
      const phrases = [...new Set(raw.split(',').map((value) => value.trim()).filter(Boolean))];

      if (!phrases.length) {
        await interaction.reply({ content: 'Add at least one phrase.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply({ content: renderProgressMessage(0, 'Updating exact event name phrases...') });
      updateConfig(`teams.${team}.eventNamePhrases`, phrases);
      await interaction.editReply({ content: renderProgressMessage(40, 'Saving exact phrase matching...') });
      await logAdminUiAction(interaction, 'admin', 'set-event-phrases', { team, phrases });

      try {
        await interaction.editReply({ content: renderProgressMessage(70, 'Syncing configuration...') });
        await syncConfigSnapshotIfEnabled();
      } catch (error) {
        await interaction.editReply({ content: `✅ Event phrases updated. ⚠️ Sync warning: ${error.message}` });
        return;
      }

      const latestConfig = loadConfig();
      await refreshFixtureSettingsMessage(interaction, team);
      await interaction.editReply({
        content: `${renderProgressMessage(100, `Event phrases updated for **${getTeamMeta(latestConfig, team).label}**.`)}\n${phrases.join(', ')}`
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'admin_new_team_modal') {
      if (!hasAdminAccess(interaction.member, config)) {
        await denyAdminAccess();
        return;
      }

      const rawTeamKey = interaction.fields.getTextInputValue('team_key').trim().toLowerCase();
      const teamLabel = interaction.fields.getTextInputValue('team_label').trim();
      const teamEmoji = interaction.fields.getTextInputValue('team_emoji').trim() || '🔹';
      const teamGender = interaction.fields.getTextInputValue('team_gender').trim().toLowerCase();
      const teamKey = rawTeamKey.replace(/[^a-z0-9_-]/g, '');

      if (!teamKey || teamKey.length < 2) {
        await interaction.reply({ content: 'Team key must contain at least 2 valid characters (a-z, 0-9, _ or -).', flags: MessageFlags.Ephemeral });
        return;
      }

      if (config.teams?.[teamKey]) {
        await interaction.reply({ content: `Team \`${teamKey}\` already exists.`, flags: MessageFlags.Ephemeral });
        return;
      }
      if (!['male', 'female', 'mixed'].includes(teamGender)) {
        await interaction.reply({ content: 'Team gender must be male, female, or mixed.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply({ content: renderProgressMessage(0, 'Creating new team...') });
      updateConfig(`teams.${teamKey}`, { emoji: teamEmoji, label: teamLabel, gender: teamGender, eventNamePhrases: [] });
      updateConfig(`roles.${teamKey}`, { player: 'ROLE_ID', coach: 'ROLE_ID' });
      updateConfig(`channels.teamChats.${teamKey}`, '');
      updateConfig(`channels.staffRooms.${teamKey}`, '');
      updateConfig(`channels.privateChatCategories.${teamKey}`, '');
      await interaction.editReply({ content: renderProgressMessage(40, 'Saving team configuration...') });
      await logAdminUiAction(interaction, 'admin', 'new-team', { teamKey, teamLabel });

      try {
        await interaction.editReply({ content: renderProgressMessage(70, 'Syncing configuration...') });
        await syncConfigSnapshotIfEnabled();
      } catch (error) {
        await interaction.editReply({
          content: `✅ Team created: **${teamLabel}** (\`${teamKey}\`). Configure roles/chats from Admin panel. ⚠️ Sync warning: ${error.message}`
        });
        return;
      }

      await interaction.editReply({
        content: renderProgressMessage(100, `Team created: **${teamLabel}** (\`${teamKey}\`). It now appears under "Configure Existing Team".`)
      });
    }
  }
};
