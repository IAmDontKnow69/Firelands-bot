const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
    new ButtonBuilder().setCustomId('admin_action:team_management').setLabel('🛠️ Team Management').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('admin_action:player_management').setLabel('👕 Player Management').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_action:coach_management').setLabel('🧢 Coach Management').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_action:club_management').setLabel('🏟️ Club Management').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('admin_action:club_report').setLabel('📊 Club Report').setStyle(ButtonStyle.Secondary)
  );
}

function createAdminPanelSecondaryRow() {
  return null;
}

function buildAdminPanelEmbed(config = {}) {
  const teamLabels = Object.entries(config.teams || {}).map(([team, meta]) => `${meta.emoji || '🔹'} ${meta.label || team}`).join(' | ');
  return new EmbedBuilder()
    .setTitle('🔥 Firelands Bot Admin UI')
    .setDescription([
      'Use this panel to run admin actions directly (no copy/paste commands needed).',
      '',
      '**Main menu buttons:**',
      '• 🛠️ Team Management — create teams and configure roles/channels/fixtures per team.',
      '• 👕 Player Management — find a player and edit profile, teams, notes, and attendance data.',
      '• 🧢 Coach Management — manage coach profiles and coach-team assignments.',
      '• 🏟️ Club Management — Google tools, admin chat, command channel, and backups.',
      '• 📊 Club Report — team-by-team attendance summary snapshot.',
      '',
      `Current teams: ${teamLabels || 'No teams configured'}`
    ].join('\n'));
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
  createAdminPanelSecondaryRow,
  getSpreadsheetViewUrl,
  handleSetEmoji,
  handleClubReport,
  handleSyncGoogle,
  buildAdminPanelEmbed,

  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Open admin UI for config and club-level attendance')
    .setDMPermission(true)
    .addSubcommand((sub) =>
      sub
        .setName('panel')
        .setDescription('Open admin configuration panel')
    ),

  async execute(interaction) {
    const config = loadConfig();
    const guild = interaction.guild
      || await interaction.client.guilds.fetch(config.bot?.guildId || '').catch(() => null);
    const member = interaction.member
      || (guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null);

    if (!hasAdminAccess(member, config)) {
      await interaction.reply({ content: adminAccessMessage(config), flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.inGuild() && config.channels?.admin && interaction.channelId !== config.channels.admin) {
      await interaction.reply({
        content: `Please use this command in the admin chat: <#${config.channels.admin}>.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const view = buildAdminPanelEmbed(config);

    const rows = [createAdminPanelActionRow()].filter(Boolean);
    await interaction.reply({ embeds: [view], components: rows, flags: MessageFlags.Ephemeral });
  }
};
