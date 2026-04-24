const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const { loadDb } = require('../utils/database');
const { loadConfig, updateConfig } = require('../utils/config');

const TEAM_CHOICES = [
  { name: 'Mens', value: 'mens' },
  { name: 'Womens', value: 'womens' }
];

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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Open admin UI for config and club-level attendance')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('panel')
        .setDescription('Open admin configuration panel')
    )
    .addSubcommand((sub) =>
      sub
        .setName('set-emoji')
        .setDescription('Assign a Discord emoji to a team label')
        .addStringOption((opt) => opt.setName('team').setDescription('Team').setRequired(true).addChoices(...TEAM_CHOICES))
        .addStringOption((opt) => opt.setName('emoji').setDescription('Emoji, e.g. :blue_circle:').setRequired(true).setMaxLength(40))
    )
    .addSubcommand((sub) =>
      sub
        .setName('club-report')
        .setDescription('Show attendance overview for every team in the club')
    ),

  async execute(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: 'Administrator permission is required.', ephemeral: true });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'set-emoji') {
      const team = interaction.options.getString('team', true);
      const emoji = interaction.options.getString('emoji', true).trim();
      updateConfig(`teams.${team}.emoji`, emoji);

      await interaction.reply({
        content: `✅ Team label updated: ${emoji} **${team === 'mens' ? 'Mens Team' : "Women's Team"}**`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === 'club-report') {
      const config = loadConfig();
      const db = loadDb();
      const sections = [];

      for (const team of ['mens', 'womens']) {
        const teamEmoji = config.teams?.[team]?.emoji || '🔹';
        const { totals, players, eventCount } = countPlayerAttendanceForTeam(interaction.guild, team, config, db);

        const perPlayer = players.length
          ? players.map((id) => {
            const t = totals[id];
            return `<@${id}> — ✅ ${t.attended} | 🔴 ${t.unavailable} | ❓ ${t.noResponse}`;
          }).join('\n')
          : '*No players found for configured role.*';

        sections.push([
          `${teamEmoji} **${team === 'mens' ? 'Mens Team' : "Women's Team"}**`,
          `Events tracked: ${eventCount}`,
          perPlayer
        ].join('\n'));
      }

      const embed = new EmbedBuilder()
        .setTitle('Admin UI — Club Attendance Report')
        .setDescription(sections.join('\n\n'))
        .setColor(0x9b59b6);

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const config = loadConfig();
    const view = new EmbedBuilder()
      .setTitle('Admin UI')
      .setDescription([
        'Use this UI command set:',
        '• Set Roles & Team Chats opens a team picker first, then role/chat/fixture team options.',
        '• `/admin set-emoji` to set team labels with emoji.',
        '• `/admin club-report` to review attendance for every team.',
        '• `/admin-config` remains available for full low-level config fields.',
        '',
        `Current labels: ${config.teams?.mens?.emoji || '🔵'} Mens Team | ${config.teams?.womens?.emoji || '🔴'} Women's Team`
      ].join('\n'));

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('admin_quick_action')
        .setPlaceholder('Pick an action')
        .addOptions([
          { label: 'Set Roles & Team Chats', value: 'set_team_ids', description: 'Choose a team, then set role/chat IDs and fixture team' },
          { label: 'Set Google Calendar ID', value: 'set_calendar_id', description: 'Update the calendar used by sync' },
          { label: 'View Google Calendar Events', value: 'view_google_events', description: 'Show upcoming events from Google Calendar' },
          { label: 'Club Report', value: 'club_report', description: 'View club attendance report' },
          { label: 'Config Help', value: 'config_help', description: 'Show config usage notes' }
        ])
    );

    await interaction.reply({ embeds: [view], components: [row], ephemeral: true });
  }
};
