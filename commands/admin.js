const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags
} = require('discord.js');
const { loadDb } = require('../utils/database');
const { loadConfig, updateConfig } = require('../utils/config');
const { syncAllToSheet } = require('../utils/googleSheetsSync');
const { hasAdminAccess, adminAccessMessage } = require('../utils/adminAccess');

function getSpreadsheetViewUrl(config = {}) {
  const input = config.googleSync?.spreadsheetId || '';
  if (!input) return '';
  if (String(input).includes('docs.google.com/spreadsheets')) return String(input).trim();
  return `https://docs.google.com/spreadsheets/d/${String(input).trim()}`;
}

function createAdminPanelActionRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('admin_quick_action')
      .setPlaceholder('Pick an action')
      .addOptions([
        { label: 'Set Roles & Team Chats', value: 'set_team_ids', description: 'Choose a team, then set role/chat IDs and fixture team' },
        { label: 'Club Report', value: 'club_report', description: 'Run admin club attendance report' },
        { label: 'Create New Team', value: 'new_team', description: 'Add a new team for role/chat setup' },
        { label: 'Set Team Emoji', value: 'set_emoji', description: 'Run admin set-emoji from this panel' },
        { label: 'Config View', value: 'config_view', description: 'Run admin-config view from this panel' },
        { label: 'Sync Google Sheets', value: 'sync_google', description: 'Run admin-config sync-google from this panel' },
        { label: 'Open Google Sheet', value: 'open_google_sheet', description: 'Get link to open configured sheet' },
        { label: 'Set Google Calendar ID', value: 'set_calendar_id', description: 'Update the calendar used by sync' },
        { label: 'View Google Calendar Events', value: 'view_google_events', description: 'Show upcoming events from Google Calendar' }
      ])
  );
}

function countPlayerAttendanceForTeam(guild, team, config, db) {
  const roleId = config.roles?.[team]?.player;
  const role = roleId ? guild.roles.cache.get(roleId) : null;
  const players = role ? Array.from(role.members.keys()) : [];

  const totals = {};

  for (const playerId of players) {
    totals[playerId] = { attended: 0, unavailable: 0, noResponse: 0 };
  }

  const teamEvents = Object.values(db.events).filter((event) => event.team === team);

  for (const event of teamEvents) {
    const responses = event.responses || {};
    for (const playerId of players) {
      const response = responses[playerId];
      if (!response) {
        totals[playerId].noResponse += 1;
      } else if (response.status === 'yes') {
        totals[playerId].attended += 1;
      } else {
        totals[playerId].unavailable += 1;
      }
    }
  }

  return { totals, players, eventCount: teamEvents.length };
}

async function handleSetEmoji(interaction, team, emoji) {
  updateConfig(`teams.${team}.emoji`, emoji.trim());
  const config = loadConfig();
  const label = config.teams?.[team]?.label || team;

  await interaction.reply({
    content: `✅ Team label updated: ${emoji.trim()} **${label}**`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleClubReport(interaction) {
  const config = loadConfig();
  const db = loadDb();
  const sections = [];

  for (const team of Object.keys(config.teams || {})) {
    const teamEmoji = config.teams?.[team]?.emoji || '🔹';
    const teamLabel = config.teams?.[team]?.label || team;
    const { totals, players, eventCount } = countPlayerAttendanceForTeam(interaction.guild, team, config, db);

    const perPlayer = players.length
      ? players.map((id) => {
        const t = totals[id];
        return `<@${id}> — ✅ ${t.attended} | 🔴 ${t.unavailable} | ❓ ${t.noResponse}`;
      }).join('\n')
      : '*No players found for configured role.*';

    sections.push([
      `${teamEmoji} **${teamLabel}**`,
      `Events tracked: ${eventCount}`,
      perPlayer
    ].join('\n'));
  }

  const embed = new EmbedBuilder()
    .setTitle('Admin UI — Club Attendance Report')
    .setDescription(sections.join('\n\n'))
    .setColor(0x9b59b6);

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleSyncGoogle(interaction, spreadsheetInput = '') {
  if (spreadsheetInput?.trim()) {
    updateConfig('googleSync.spreadsheetId', spreadsheetInput.trim());
  }

  updateConfig('googleSync.enabled', true);

  const latestConfig = loadConfig();
  const db = loadDb();
  const result = await syncAllToSheet(latestConfig, db);

  if (!result.ok) {
    await interaction.reply({
      content: 'Could not sync because spreadsheet ID is not configured.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.reply({
    content: `✅ Synced fixtures, attendance, command log, and config to Google Sheets (\`${result.spreadsheetId}\`).`,
    flags: MessageFlags.Ephemeral
  });
}

module.exports = {
  createAdminPanelActionRow,
  getSpreadsheetViewUrl,
  handleSetEmoji,
  handleClubReport,
  handleSyncGoogle,

  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Open admin UI for config and club-level attendance')
    .addSubcommand((sub) =>
      sub
        .setName('panel')
        .setDescription('Open admin configuration panel')
    ),

  async execute(interaction) {
    const config = loadConfig();
    if (!hasAdminAccess(interaction.member, config)) {
      await interaction.reply({ content: adminAccessMessage(config), flags: MessageFlags.Ephemeral });
      return;
    }

    const teamLabels = Object.entries(config.teams || {}).map(([team, meta]) => `${meta.emoji || '🔹'} ${meta.label || team}`).join(' | ');
    const view = new EmbedBuilder()
      .setTitle('Admin UI')
      .setDescription([
        'Use this panel to run admin actions directly (no copy/paste commands needed).',
        'Actions include team setup, creating teams, club report, config view, google sync, and opening the sheet.',
        '',
        `Current labels: ${teamLabels || 'No teams configured'}`
      ].join('\n'));

    await interaction.reply({ embeds: [view], components: [createAdminPanelActionRow()], flags: MessageFlags.Ephemeral });
  }
};
