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
const { loadConfig, updateConfig } = require('../utils/config');
const { getTeamSetupProgress } = require('../utils/teamSetup');
const { fetchCalendarEvents, titleMatchesPhrase } = require('../utils/googleCalendar');
const { syncAllToSheet, appendCommandLogRow } = require('../utils/googleSheetsSync');
const coachCommand = require('../commands/coach');
const adminCommand = require('../commands/admin');
const adminConfigCommand = require('../commands/admin-config');
const { hasAdminAccess, adminAccessMessage } = require('../utils/adminAccess');
const { determineEventType, eventTypeLabel, getEventTypeConfig } = require('../utils/eventType');

function getTeamMeta(config = {}, team = '') {
  const teamConfig = config.teams?.[team] || {};
  return {
    label: teamConfig.label || team,
    emoji: teamConfig.emoji || '🔹'
  };
}

function createAdminQuickActionRow() {
  return adminCommand.createAdminPanelActionRow();
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
    new StringSelectMenuBuilder()
      .setCustomId('admin_team_management_action')
      .setPlaceholder('Team Management actions')
      .addOptions([
        { label: 'Configure Existing Team', value: 'configure_team', description: 'Select a team, view current settings, and edit' },
        { label: 'Create New Team', value: 'new_team', description: 'Create a new team for setup' }
      ])
  );
}

function createGoogleToolsRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_google_tools_action')
      .setPlaceholder('Google actions')
      .addOptions([
        { label: 'Sync Google Sheets', value: 'sync_google', description: 'Force-sync fixtures and attendance to Sheets' },
        { label: 'Open Google Sheet', value: 'open_google_sheet', description: 'Open configured Google Sheet' },
        { label: 'Set Google Calendar ID', value: 'set_calendar_id', description: 'Set calendar used for sync' },
        { label: 'Set Admin Chat', value: 'set_admin_chat', description: 'Choose where admin logs + errors are posted' },
        { label: 'Set Bot Commands Chat', value: 'set_bot_commands_chat', description: 'Choose where /player and /coach can be used' },
        { label: 'Event Type Rules', value: 'event_type_rules', description: 'Configure how events are classified' },
        { label: 'View Google Calendar Events', value: 'view_google_events', description: 'Preview synced calendar events' }
      ])
  );
}

function createEventTypeRulesRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_event_type_rules_action')
      .setPlaceholder('Event type rule actions')
      .addOptions([
        { label: 'Toggle Auto Detect', value: 'toggle_auto_detect', description: 'Enable/disable keyword auto classification' },
        { label: 'Set Practice Exact Names', value: 'set_practice_exact', description: 'Comma-separated exact names that mean practice' },
        { label: 'Set Match Exact Names', value: 'set_match_exact', description: 'Comma-separated exact names that mean match' },
        { label: 'Set Other Exact Names', value: 'set_other_exact', description: 'Comma-separated exact names that mean other' },
        { label: 'Manually Set Event Type', value: 'manual_set_event_type', description: 'Pick a fixture and assign a type manually' }
      ])
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
  const label = getTeamMeta(config, team).label;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`admin_team_config_action:${team}`)
      .setPlaceholder(`Configure ${label}`)
      .addOptions([
        { label: 'Set Player Role ID', value: 'player_role', description: `Set ${label} player role` },
        { label: 'Set Coach Role ID', value: 'coach_role', description: `Set ${label} coach role` },
        { label: 'Set Team Chat ID', value: 'team_chat', description: `Set ${label} team chat channel` },
        { label: 'Set Staff Room ID', value: 'staff_room', description: `Set ${label} staff room channel` },
        { label: 'Set Private Chat Category', value: 'private_category', description: `Set category for attendance chats` },
        { label: 'Set Team Emoji', value: 'team_emoji', description: `Set emoji for ${label}` },
        { label: 'Set Captain Role ID', value: 'captain_role', description: `Set ${label} captain role` },
        { label: 'Set Captain Emoji', value: 'captain_emoji', description: `Set captain emoji shown after team emoji` },
        { label: 'Set Team Name', value: 'team_name', description: `Rename ${label}` },
        { label: 'Set Event Name Phrases', value: 'event_name_phrases', description: `Set exact phrase matching for ${label}` },
        { label: 'Set Fixture Team', value: 'fixture_team', description: `Assign a fixture to ${label}` },
        { label: 'Auto-Assign Fixtures by Name', value: 'auto_assign_fixtures', description: `Match fixtures to ${label} by exact phrase` },
        { label: 'Force Send Attendance', value: 'force_send_attendance', description: `Post attendance prompts for ${label} fixtures` }
      ])
  );
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
    `Now configuring: ${meta.emoji} **${meta.label}** (\`${team}\`)`,
    `Setup progress: **${progress.completed}/${progress.total} (${progress.percent}%)** ${progress.isComplete ? '✅ Ready' : '⚠️ Incomplete'}`,
    '',
    '**Current configuration**',
    `• Player Role: ${formatConfigRef(guild, 'role', config.roles?.[team]?.player)}`,
    `• Coach Role: ${formatConfigRef(guild, 'role', config.roles?.[team]?.coach)}`,
    `• Team Chat: ${formatConfigRef(guild, 'channel', config.channels?.teamChats?.[team])}`,
    `• Staff Room: ${formatConfigRef(guild, 'channel', config.channels?.staffRooms?.[team])}`,
    `• Private Chat Category: ${formatConfigRef(guild, 'channel', config.channels?.privateChatCategories?.[team])}`,
    `• Team Emoji: ${meta.emoji}`,
    `• Captain Role: ${formatConfigRef(guild, 'role', config.teams?.[team]?.captainRoleId)}`,
    `• Captain Emoji: ${config.teams?.[team]?.captainEmoji || 'not set'}`,
    `• Event Name Phrases (exact): ${(config.teams?.[team]?.eventNamePhrases || []).join(', ') || 'not set'}`,
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
    content: `<@&${teamRoleId}>\n📅 ${event.title}\n🕒 ${new Date(event.date).toLocaleString()}\nPlease mark your availability now.`,
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
    lines.push(`• ${date.toLocaleString()} — ${formatTeamLabel(event, config)} — **${shortTitle}** — ${attendance}`);
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
  return profile?.nickName || profile?.customName || member?.displayName || user?.globalName || user?.username || 'Player';
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

function createPlayerManagementRow(mode = 'player') {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(mode === 'coach' ? 'admin_coach_select' : 'admin_player_select')
      .setPlaceholder(mode === 'coach' ? 'Select a coach to manage' : 'Select a player to manage')
      .setMinValues(1)
      .setMaxValues(1)
  );
}

function createCoachManagementRow(config, guild) {
  const coachIds = new Set();
  for (const teamKey of Object.keys(config.teams || {})) {
    const coachRoleId = config.roles?.[teamKey]?.coach;
    const role = coachRoleId ? guild.roles.cache.get(coachRoleId) : null;
    if (!role) continue;
    for (const memberId of role.members.keys()) coachIds.add(memberId);
  }

  const options = Array.from(coachIds).slice(0, 25).map((userId) => {
    const member = guild.members.cache.get(userId);
    return {
      label: (member?.displayName || member?.user?.username || userId).slice(0, 100),
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
    new ButtonBuilder().setCustomId(`admin_player_action:set_name:${userId}:${mode}`).setLabel('Name').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`admin_player_action:set_nickname:${userId}:${mode}`).setLabel('Nickname').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`admin_player_action:set_face:${userId}:${mode}`).setLabel('Photo URL').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`admin_player_action:set_shirt:${userId}:${mode}`).setLabel('Shirt').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`admin_player_action:set_notes:${userId}:${mode}`).setLabel('Notes').setStyle(ButtonStyle.Secondary)
  );
}

function createPlayerProfileActionRow2(userId, mode = 'player') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`admin_player_action:set_teams:${userId}:${mode}`).setLabel('Teams').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_player_action:assign_roles:${userId}:${mode}`).setLabel('Assign Roles').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_player_action:set_joined:${userId}:${mode}`).setLabel('Joined').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`admin_player_view_attendance:${userId}:${mode}`).setLabel('Attendance').setStyle(ButtonStyle.Success)
  );
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
      .setPlaceholder('Select roles to add')
      .setMinValues(1)
      .setMaxValues(10)
  );
}

function createAttendanceOnlyRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`admin_player_view_attendance:${userId}:player`)
      .setLabel('Attendance')
      .setStyle(ButtonStyle.Success)
  );
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
      content: 'Select roles to add to this player.',
      embeds: [],
      components: [createPlayerRoleAssignRow(userId, mode), createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')]
    });
    return true;
  }

  const modalTitles = {
    set_name: mode === 'coach' ? 'Set Coach Real Name' : 'Set Player Real Name',
    set_nickname: mode === 'coach' ? 'Set Coach Nickname' : 'Set Player Nickname',
    set_face: 'Set Player Face URL (.png or .webp)',
    set_shirt: 'Set Player Shirt Number',
    set_joined: 'Set Joined Date (YYYY-MM-DD)',
    set_notes: 'Set Player Notes'
  };
  const fieldByAction = {
    set_name: { id: 'custom_name', label: 'Real name', value: mergedProfile.customName || '' },
    set_nickname: { id: 'nickname', label: 'Nickname', value: mergedProfile.nickName || '' },
    set_face: { id: 'face_image_url', label: 'Face image URL', value: mergedProfile.faceImageUrl || mergedProfile.facePngUrl || '' },
    set_shirt: { id: 'shirt_number', label: 'Shirt number', value: mergedProfile.shirtNumber || '' },
    set_joined: { id: 'joined_discord_at', label: 'Joined date', value: mergedProfile.joinedDiscordAt || (targetMember?.joinedAt ? targetMember.joinedAt.toISOString().slice(0, 10) : '') },
    set_notes: { id: 'notes', label: 'Profile notes', value: mergedProfile.notes || '' }
  };
  const field = fieldByAction[selectedAction];
  if (!field) return false;

  const modal = new ModalBuilder()
    .setCustomId(`admin_player_profile_modal:${selectedAction}:${userId}:${mode}`)
    .setTitle(modalTitles[selectedAction] || 'Update Player Profile');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(field.id)
        .setLabel(field.label)
        .setStyle(selectedAction === 'set_notes' ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(!['set_notes', 'set_face'].includes(selectedAction))
        .setValue(field.value)
        .setMaxLength(selectedAction === 'set_notes' ? 300 : 200)
    )
  );

  await interaction.showModal(modal);
  return true;
}

function buildPlayerProfileSummary(config, guild, user, member, profile = {}, mode = 'player') {
  const discordName = user?.tag || user?.username || profile.userId || 'Unknown';
  const displayName = getPlayerNameForUi(user, member, profile);
  const teamLabels = (profile.teams || []).map((team) => getTeamMeta(config, team).label).join(', ') || 'not set';
  const coachTeamLabels = (profile.coachTeams || []).map((team) => getTeamMeta(config, team).label).join(', ') || 'not set';
  const roles = (profile.roles || []).map((roleId) => formatConfigRef(guild, 'role', roleId)).join(', ') || 'not set';
  const joined = profile.joinedDiscordAt || (member?.joinedAt ? member.joinedAt.toISOString().slice(0, 10) : 'unknown');
  const shirtNumber = profile.shirtNumber || 'not set';
  const faceImageUrl = profile.faceImageUrl || profile.facePngUrl || 'not set';
  const notes = profile.notes || 'none';

  const managerLabel = mode === 'coach' ? 'Managing manager (coach profile)' : 'Managing player';

  return [
    `${managerLabel}: <@${user?.id || profile.userId}>`,
    `• Discord: ${discordName}`,
    `• Real Name: ${displayName}`,
    `• Nickname: ${profile.nickName || 'not set'}`,
    `• Shirt Number: ${shirtNumber}`,
    `• Face Image: ${faceImageUrl}`,
    `• Teams: ${teamLabels}`,
    `• Teams Coaching: ${coachTeamLabels}`,
    `• Roles: ${roles}`,
    `• Joined Discord: ${joined}`,
    `• Notes: ${notes}`
  ].join('\n');
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

function createAbsenceTicketDecisionRow(eventId, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`absence_ticket_confirm:${eventId}:${userId}`)
      .setLabel('✅ Confirm Not Attending')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`absence_ticket_decline:${eventId}:${userId}`)
      .setLabel('↩️ Decline (Ask to Attend)')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`absence_ticket_player_attend:${eventId}:${userId}`)
      .setLabel('🟢 I can attend')
      .setStyle(ButtonStyle.Primary)
  );
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
  await syncAllToSheet(latestConfig, loadDb());
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
        await interaction.update({
          content: 'Admin panel:',
          embeds: [],
          components: [createAdminQuickActionRow()]
        });
        return;
      }
      if (interaction.customId === 'admin_back_team_management') {
        await interaction.update({
          content: 'Team Management:',
          embeds: [],
          components: [createTeamManagementRow(), createAdminBackButtonRow()]
        });
        return;
      }
      if (interaction.customId === 'admin_back_google_tools') {
        await interaction.update({
          content: 'Google Tools:',
          embeds: [],
          components: [createGoogleToolsRow(), createAdminBackButtonRow()]
        });
        return;
      }
      if (interaction.customId === 'admin_back_player_management') {
        await interaction.update({
          content: 'Player Management: select a player to edit profile details.',
          embeds: [],
          components: [createPlayerManagementRow('player'), createAdminBackButtonRow()]
        });
        return;
      }
      if (interaction.customId === 'admin_back_coach_management') {
        await interaction.update({
          content: 'Coach Management: select a coach to edit profile details.',
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

        modal.addComponents(
          new ActionRowBuilder().addComponents(keyInput),
          new ActionRowBuilder().addComponents(labelInput),
          new ActionRowBuilder().addComponents(emojiInput)
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
      if (interaction.customId.startsWith('admin_player_view_attendance:')) {
        const [, userId] = interaction.customId.split(':');
        await interaction.reply({
          content: buildAttendanceStatsMessage(userId, loadConfig()),
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (interaction.customId.startsWith('absence_ticket_confirm:') || interaction.customId.startsWith('absence_ticket_decline:') || interaction.customId.startsWith('absence_ticket_player_attend:')) {
        const [, eventId, playerId] = interaction.customId.split(':');
        const db = loadDb();
        const event = db.events[eventId];
        if (!event) {
          await interaction.reply({ content: 'Event no longer exists for this ticket.', flags: MessageFlags.Ephemeral });
          return;
        }

        const teamRoles = teamRolesMap[event.team];

        if (interaction.customId.startsWith('absence_ticket_player_attend:')) {
          if (interaction.user.id !== playerId) {
            await interaction.reply({ content: 'Only the player can use this button.', flags: MessageFlags.Ephemeral });
            return;
          }
          setResponse(eventId, playerId, {
            status: 'yes',
            reason: '',
            confirmed: false,
            updatedAt: new Date().toISOString()
          });
          await triggerGoogleSync(context);
          await interaction.reply({ content: '🟢 Marked as attending. This absence ticket can be closed.' });
          await context.sendLog(`🟢 <@${playerId}> switched to attending for **${event.title}** from the ticket channel.`);
          return;
        }

        if (!teamRoles?.coach || !hasRole(interaction.member, teamRoles.coach)) {
          await interaction.reply({ content: 'Only team coaches/staff can use this decision button.', flags: MessageFlags.Ephemeral });
          return;
        }

        if (interaction.customId.startsWith('absence_ticket_confirm:')) {
          setResponse(eventId, playerId, {
            status: 'confirmed_no',
            confirmed: true,
            confirmedBy: interaction.user.id,
            confirmedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          await triggerGoogleSync(context);
          await interaction.reply({ content: `✅ Absence confirmed for <@${playerId}>.` });
          await context.sendLog(`✅ ${interaction.user.tag} confirmed not attending for <@${playerId}> on **${event.title}**.`);
          return;
        }

        clearResponse(eventId, playerId);
        await triggerGoogleSync(context);
        const member = await interaction.guild.members.fetch(playerId).catch(() => null);
        await member?.send(`Your absence request for **${event.title}** was declined. Please use the attendance button to confirm you can attend.`).catch(() => null);
        await interaction.reply({
          content: [
            `↩️ Absence request declined for <@${playerId}>.`,
            'Player should now confirm attendance from the original event message.'
          ].join('\n')
        });
        await context.sendLog(`↩️ ${interaction.user.tag} declined not-attending request for <@${playerId}> on **${event.title}**.`);
        return;
      }

      const parsed = parseCustomId(interaction.customId);
      const db = loadDb();
      const event = db.events[parsed.eventId];

      if (!event) {
        await interaction.reply({ content: 'Event not found.', flags: MessageFlags.Ephemeral });
        return;
      }

      const teamRoles = teamRolesMap[event.team];
      if (!teamRoles) {
        await interaction.reply({ content: 'Team roles are not configured for this event.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (parsed.action === 'attend_yes') {
        if (!hasRole(interaction.member, teamRoles.player)) {
          await interaction.reply({ content: 'Only players for this team can respond.', flags: MessageFlags.Ephemeral });
          return;
        }
        const existing = db.events[parsed.eventId]?.responses?.[interaction.user.id];
        if (existing?.status === 'yes') {
          await interaction.reply({ content: 'You are already marked as attending for this event.', flags: MessageFlags.Ephemeral });
          return;
        }

        setResponse(parsed.eventId, interaction.user.id, {
          status: 'yes',
          reason: '',
          confirmed: false,
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
        if (!hasRole(interaction.member, teamRoles.player)) {
          await interaction.reply({ content: 'Only players for this team can respond.', flags: MessageFlags.Ephemeral });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId(`absence_reason:${parsed.eventId}`)
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
          updatedAt: new Date().toISOString()
        });

        await interaction.reply({ content: `✅ Absence confirmed for <@${targetUserId}>.` });
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

      if (interaction.customId === 'coach_team_select') {
        const selectedTeam = interaction.values[0];
        const report = coachCommand.buildReport(interaction.guild, selectedTeam, teamRolesMap);

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
          content: buildPlayerProfileSummary(loadConfig(), interaction.guild, user, member, profile, 'player'),
          embeds: [],
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
          content: buildPlayerProfileSummary(loadConfig(), interaction.guild, user, member, seeded, 'coach'),
          embeds: [],
          components: [createPlayerProfileActionRow(userId, 'coach'), createPlayerProfileActionRow2(userId, 'coach'), createBackButtonRow('admin_back_coach_management')]
        });
        return;
      }

      if (interaction.customId === 'admin_quick_action') {
        const action = interaction.values[0];
        if (action === 'team_management') {
          await interaction.update({
            content: 'Team Management:',
            embeds: [],
            components: [createTeamManagementRow(), createAdminBackButtonRow()]
          });
          return;
        }

        if (action === 'google_tools') {
          await interaction.update({
            content: 'Google Tools:',
            embeds: [],
            components: [createGoogleToolsRow(), createAdminBackButtonRow()]
          });
          return;
        }

        if (action === 'player_management') {
          await interaction.update({
            content: 'Player Management: select a player to edit profile details.',
            embeds: [],
            components: [createPlayerManagementRow('player'), createAdminBackButtonRow()]
          });
          return;
        }

        if (action === 'coach_management') {
          await interaction.update({
            content: 'Coach Management: only users with coach roles are shown here.',
            embeds: [],
            components: [createCoachManagementRow(loadConfig(), interaction.guild), createAdminBackButtonRow()]
          });
          return;
        }

        if (action === 'config_view') {
          await logAdminUiAction(interaction, 'admin-config', 'view');
          await adminConfigCommand.handleView(interaction);
          return;
        }

        if (action === 'club_report') {
          await logAdminUiAction(interaction, 'admin', 'club-report');
          await adminCommand.handleClubReport(interaction);
          return;
        }

        await interaction.update({
          content: 'Unknown admin action.',
          embeds: [],
          components: [createAdminQuickActionRow()]
        });
        return;
      }

      if (interaction.customId === 'admin_team_management_action' || interaction.customId === 'admin_google_tools_action') {
        const action = interaction.values[0];

        if (action === 'configure_team') {
          await interaction.update({
            content: 'Select your team first. Then choose what to change. You can also create a new team here.',
            embeds: [],
            components: [createTeamPickerRow(config, 'admin_team_config_select', 'Select a team to configure'), createTeamPickerButtonsRow()]
          });
          return;
        }

        if (action === 'set_calendar_id') {
          const modal = new ModalBuilder()
            .setCustomId('admin_set_calendar_modal')
            .setTitle('Set Google Calendar ID');

          const calendarIdInput = new TextInputBuilder()
            .setCustomId('calendar_id')
            .setLabel('Google Calendar ID (email-like)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(config.bot.calendarId || '')
            .setMaxLength(150);

          modal.addComponents(new ActionRowBuilder().addComponents(calendarIdInput));
          await interaction.showModal(modal);
          return;
        }

        if (action === 'new_team') {
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

          modal.addComponents(
            new ActionRowBuilder().addComponents(keyInput),
            new ActionRowBuilder().addComponents(labelInput),
            new ActionRowBuilder().addComponents(emojiInput)
          );
          await interaction.showModal(modal);
          return;
        }
        if (action === 'set_admin_chat') {
          const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId('admin_set_channel:channels.admin:global')
              .setPlaceholder('Choose Admin Chat channel')
              .setChannelTypes(ChannelType.GuildText)
              .setMinValues(1)
              .setMaxValues(1)
          );
          await interaction.update({
            content: 'Select the Admin chat channel. Bot errors + interaction failures are posted there.',
            embeds: [],
            components: [row, createBackButtonRow('admin_back_google_tools')]
          });
          return;
        }
        if (action === 'set_bot_commands_chat') {
          const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId('admin_set_channel:channels.botCommands:global')
              .setPlaceholder('Choose Bot Commands channel')
              .setChannelTypes(ChannelType.GuildText)
              .setMinValues(1)
              .setMaxValues(1)
          );
          await interaction.update({
            content: 'Select the channel where /player and /coach commands must be used.',
            embeds: [],
            components: [row, createBackButtonRow('admin_back_google_tools')]
          });
          return;
        }
        if (action === 'event_type_rules') {
          const rules = getEventTypeConfig(loadConfig());
          await interaction.update({
            content: [
              'Event type rules:',
              `• Auto Detect: **${rules.autoDetect ? 'ON' : 'OFF'}**`,
              `• Practice Exact Names: ${rules.practiceExactNames.join(', ') || 'none'}`,
              `• Match Exact Names: ${rules.matchExactNames.join(', ') || 'none'}`,
              `• Other Exact Names: ${rules.otherExactNames.join(', ') || 'none'}`
            ].join('\n'),
            embeds: [],
            components: [createEventTypeRulesRow(), createBackButtonRow('admin_back_google_tools')]
          });
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

          await interaction.update({
            content: sheetUrl
              ? `Open Google Sheet: ${sheetUrl}`
              : 'Google spreadsheet is not configured yet. Set it first via /admin-config set.',
            embeds: [],
            components: [createGoogleToolsRow(), createAdminBackButtonRow()]
          });
          return;
        }

        if (action === 'view_google_events') {
          await interaction.update({
            content: 'Choose a team to view fixtures, or choose **All Teams**.',
            embeds: [],
            components: [createEventScopePickerRow(config), createAdminQuickActionRow(), createAdminBackButtonRow()]
          });
          return;
        }

        await interaction.update({
          content: 'Unknown admin action.',
          embeds: [],
          components: [interaction.customId === 'admin_google_tools_action' ? createGoogleToolsRow() : createTeamManagementRow(), createAdminBackButtonRow()]
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
            components: [createEventTypeRulesRow(), createBackButtonRow('admin_back_google_tools')]
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
              components: [createEventTypeRulesRow(), createBackButtonRow('admin_back_google_tools')]
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
              createBackButtonRow('admin_back_google_tools')
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
            createBackButtonRow('admin_back_google_tools')
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
          components: [createEventTypeRulesRow(), createBackButtonRow('admin_back_google_tools')]
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
            components: [createAdminQuickActionRow()]
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
            components: [createGoogleToolsRow(), createAdminBackButtonRow()]
          });
        }
        return;
      }

      if (interaction.customId.startsWith('admin_team_config_action:')) {
        const team = interaction.customId.split(':')[1];
        const selectedAction = interaction.values[0];
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
              .setPlaceholder(`Choose ${teamLabel} Private Chat Category`)
              .setChannelTypes(ChannelType.GuildCategory)
              .setMinValues(1)
              .setMaxValues(1)
          );

          await interaction.update({
            content: `Select the category where **${teamLabel}** private attendance chats will be created.`,
            embeds: [],
            components: [row, createBackButtonRow(`admin_back_team_config:${team}`)]
          });
          return;
        }

        if (selectedAction === 'team_emoji') {
          const modal = new ModalBuilder()
            .setCustomId(`admin_set_team_emoji_modal:${team}`)
            .setTitle(`Set ${teamLabel} Emoji`);

          const emojiInput = new TextInputBuilder()
            .setCustomId('emoji')
            .setLabel('Emoji, e.g. 🔵 or :blue_circle:')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(getTeamMeta(config, team).emoji)
            .setMaxLength(40);

          modal.addComponents(new ActionRowBuilder().addComponents(emojiInput));
          await interaction.showModal(modal);
          return;
        }

        if (selectedAction === 'captain_emoji') {
          const modal = new ModalBuilder()
            .setCustomId(`admin_set_captain_emoji_modal:${team}`)
            .setTitle(`Set ${teamLabel} Captain Emoji`);

          const emojiInput = new TextInputBuilder()
            .setCustomId('captain_emoji')
            .setLabel('Emoji to show for captains')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(config.teams?.[team]?.captainEmoji || '🅒')
            .setMaxLength(40);

          modal.addComponents(new ActionRowBuilder().addComponents(emojiInput));
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
          const upcomingEvents = Object.entries(db.events)
            .map(([id, event]) => ({ id, ...event }))
            .filter((event) => new Date(event.date).getTime() >= Date.now())
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .slice(0, 25);

          if (!upcomingEvents.length) {
            await interaction.update({
              content: 'No upcoming fixtures found in synced events yet.',
              embeds: [],
              components: [createTeamConfigActionRow(config, team), createBackButtonRow('admin_back_team_management')]
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
                    description: `Current: ${getTeamMeta(config, event.team).label || 'Unassigned'}`.slice(0, 100)
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

      if (interaction.customId.startsWith('admin_set_fixture_team:')) {
        await interaction.deferUpdate();
        const team = interaction.customId.split(':')[1];
        const eventId = interaction.values[0];
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
          components: [createTeamConfigActionRow(config, team), createBackButtonRow('admin_back_team_management')]
        });
        return;
      }

      if (interaction.customId.startsWith('admin_player_set_teams:')) {
        const userId = interaction.customId.split(':')[1];
      const mode = interaction.customId.split(':')[2] || 'player';
      const profile = upsertPlayerProfile(userId, mode === 'coach'
        ? { coachTeams: interaction.values }
        : { teams: interaction.values });
      const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
      const targetUser = targetMember?.user || await interaction.client.users.fetch(userId).catch(() => null);
      await interaction.update({
        content: buildPlayerProfileSummary(loadConfig(), interaction.guild, targetUser, targetMember, profile, mode),
        embeds: [],
        components: [createPlayerProfileActionRow(userId, mode), createPlayerProfileActionRow2(userId, mode), createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')]
      });
      await triggerGoogleSync(context);
      return;
      }

      if (interaction.customId.startsWith('admin_force_attendance_window:')) {
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

        await interaction.update({
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
        content: buildPlayerProfileSummary(loadConfig(), interaction.guild, user, member, seeded, mode),
        embeds: [],
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
        await member.roles.add(interaction.values).catch(() => null);
      }
      const profile = upsertPlayerProfile(userId, { roles: interaction.values });
      await interaction.update({
        content: buildPlayerProfileSummary(loadConfig(), interaction.guild, member?.user, member, profile, mode),
        embeds: [],
        components: [createPlayerProfileActionRow(userId, mode), createPlayerProfileActionRow2(userId, mode), createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')]
      });
      await triggerGoogleSync(context);
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
          components: [team === 'global' ? createGoogleToolsRow() : createTeamConfigActionRow(loadConfig(), team), createBackButtonRow(team === 'global' ? 'admin_back_google_tools' : 'admin_back_team_management')]
        });
        return;
      }

      await interaction.editReply({
        content: `${renderProgressMessage(100, `Updated ${configPath} to <#${channelId}>.`)}${team === 'global' ? '' : `\n\n${getTeamConfigSummary(loadConfig(), interaction.guild, team)}`}`,
        embeds: [],
        components: [team === 'global' ? createGoogleToolsRow() : createTeamConfigActionRow(loadConfig(), team), createBackButtonRow(team === 'global' ? 'admin_back_google_tools' : 'admin_back_team_management')]
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('absence_reason:')) {
      const eventId = interaction.customId.split(':')[1];
      const db = loadDb();
      const event = db.events[eventId];

      if (!event) {
        await interaction.reply({ content: 'Event no longer exists.', flags: MessageFlags.Ephemeral });
        return;
      }

      const teamRoles = teamRolesMap[event.team];
      if (!hasRole(interaction.member, teamRoles.player)) {
        await interaction.reply({ content: 'Only players for this team can respond.', flags: MessageFlags.Ephemeral });
        return;
      }

      const reason = interaction.fields.getTextInputValue('reason').trim();
      const profile = getPlayerProfile(interaction.user.id);
      const playerDisplayName = buildRichPlayerMention(config, interaction.user, interaction.member, profile, event.team);

      setResponse(eventId, interaction.user.id, {
        status: 'pending_no',
        reason,
        confirmed: false,
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
        setAbsenceTicket(ticketChannel.id, {
          eventId,
          playerId: interaction.user.id,
          team: event.team,
          createdBy: interaction.user.id,
          createdAt: new Date().toISOString()
        });

        await ticketChannel.send({
          content: [
            `Team/Player: ${playerDisplayName} (<@${interaction.user.id}>)`,
            `Date of event: ${eventDateLabel}`,
            `Name of event: ${event.title}`,
            `Reason for not attending: ${reason}`,
            '',
            'Staff/coaches: confirm or decline this absence request below.'
          ].join('\n'),
          components: [createAbsenceTicketDecisionRow(eventId, interaction.user.id)]
        });

        const staffRoomId = config.channels.staffRooms?.[event.team];
        if (staffRoomId) {
          const staffRoom = await interaction.guild.channels.fetch(staffRoomId).catch(() => null);
          if (staffRoom?.isTextBased()) {
            await staffRoom.send(`🚨 New absence ticket opened for ${interaction.user} — ${event.title}: <#${ticketChannel.id}>`);
          }
        }

        await context.sendLog(
          `🔴 ${playerDisplayName} submitted not-attending for **${event.title}** (${eventDateLabel}). Ticket: <#${ticketChannel.id}>`
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

    if (interaction.isModalSubmit() && interaction.customId.startsWith('admin_player_profile_modal:')) {
      if (!hasAdminAccess(interaction.member, config)) {
        await denyAdminAccess();
        return;
      }
      const [, action, userId, mode = 'player'] = interaction.customId.split(':');
      const updates = {};
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      if (action === 'set_name') updates.customName = interaction.fields.getTextInputValue('custom_name').trim();
      if (action === 'set_nickname') updates.nickName = interaction.fields.getTextInputValue('nickname').trim();
      if (action === 'set_face') {
        const faceImageUrl = interaction.fields.getTextInputValue('face_image_url').trim();
        if (faceImageUrl && !/^https?:\/\/\S+\.(png|webp)(?:\?\S*)?$/i.test(faceImageUrl)) {
          await interaction.editReply({ content: 'Face URL must be a direct image link ending in .png or .webp.' });
          return;
        }
        updates.faceImageUrl = faceImageUrl;
        updates.facePngUrl = faceImageUrl;
      }
      if (action === 'set_shirt') updates.shirtNumber = interaction.fields.getTextInputValue('shirt_number').trim();
      if (action === 'set_joined') updates.joinedDiscordAt = interaction.fields.getTextInputValue('joined_discord_at').trim();
      if (action === 'set_notes') updates.notes = interaction.fields.getTextInputValue('notes').trim();

      const profile = upsertPlayerProfile(userId, updates);
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      const user = member?.user || await interaction.client.users.fetch(userId).catch(() => null);
      await triggerGoogleSync(context);

      await interaction.editReply({
        content: buildPlayerProfileSummary(loadConfig(), interaction.guild, user, member, profile, mode),
        components: [createPlayerProfileActionRow(userId, mode), createPlayerProfileActionRow2(userId, mode), createBackButtonRow(mode === 'coach' ? 'admin_back_coach_management' : 'admin_back_player_management')],
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('admin_set_team_emoji_modal:')) {
      if (!hasAdminAccess(interaction.member, config)) {
        await denyAdminAccess();
        return;
      }
      const team = interaction.customId.split(':')[1];
      const emoji = interaction.fields.getTextInputValue('emoji').trim();

      if (!config.teams?.[team]) {
        await interaction.reply({ content: 'Team key was not found in configuration.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply({ content: renderProgressMessage(0, 'Updating team emoji...') });
      await logAdminUiAction(interaction, 'admin', 'set-emoji', { team, emoji });
      updateConfig(`teams.${team}.emoji`, emoji.trim());
      await interaction.editReply({ content: renderProgressMessage(40, 'Saving emoji setting...') });
      try {
        await interaction.editReply({ content: renderProgressMessage(70, 'Syncing configuration...') });
        await syncConfigSnapshotIfEnabled();
      } catch (error) {
        await interaction.editReply({ content: `✅ Team label updated. ⚠️ Sync warning: ${error.message}` });
        return;
      }
      await interaction.editReply({ content: renderProgressMessage(100, `Team emoji updated for **${getTeamMeta(loadConfig(), team).label}**.`) });
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
        content: `${renderProgressMessage(100, `Team name updated to **${teamName}**.`)}\n\n${getTeamConfigSummary(latestConfig, interaction.guild, team)}`
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('admin_set_captain_emoji_modal:')) {
      if (!hasAdminAccess(interaction.member, config)) {
        await denyAdminAccess();
        return;
      }
      const team = interaction.customId.split(':')[1];
      const captainEmoji = interaction.fields.getTextInputValue('captain_emoji').trim() || '🅒';
      updateConfig(`teams.${team}.captainEmoji`, captainEmoji);
      await interaction.reply({
        content: `${renderProgressMessage(100, `Updated teams.${team}.captainEmoji to ${captainEmoji}.`)}\n\n${getTeamConfigSummary(loadConfig(), interaction.guild, team)}`,
        flags: MessageFlags.Ephemeral
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
      const teamKey = rawTeamKey.replace(/[^a-z0-9_-]/g, '');

      if (!teamKey || teamKey.length < 2) {
        await interaction.reply({ content: 'Team key must contain at least 2 valid characters (a-z, 0-9, _ or -).', flags: MessageFlags.Ephemeral });
        return;
      }

      if (config.teams?.[teamKey]) {
        await interaction.reply({ content: `Team \`${teamKey}\` already exists.`, flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply({ content: renderProgressMessage(0, 'Creating new team...') });
      updateConfig(`teams.${teamKey}`, { emoji: teamEmoji, label: teamLabel, eventNamePhrases: [] });
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
