const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { loadDb } = require('../utils/database');
const { determineEventType, eventTypeLabel } = require('../utils/eventType');

function getPlayerTeams(member, teamRoles) {
  return Object.entries(teamRoles)
    .filter(([, roles]) => member.roles.cache.has(roles.player))
    .map(([team]) => team);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('player')
    .setDescription('Open the player UI for upcoming training, matches, and events'),

  async execute(interaction, context) {
    const config = context.getConfig();
    const playerTeams = getPlayerTeams(interaction.member, config.roles);

    if (!playerTeams.length) {
      await interaction.reply({ content: 'You are not assigned as a player for any team.', flags: MessageFlags.Ephemeral });
      return;
    }

    const db = loadDb();
    const now = Date.now();
    const events = Object.values(db.events)
      .filter((event) => playerTeams.includes(event.team))
      .filter((event) => new Date(event.date).getTime() >= now - 2 * 60 * 60 * 1000)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 12);

    const lines = events.length
      ? events.map((event) => `• **${eventTypeLabel(determineEventType(event, config))}** — ${event.title} (${event.team})\n  ${new Date(event.date).toLocaleString()}`)
      : ['No upcoming sessions found for your teams.'];

    const teamLabels = playerTeams.map((team) => config.teams?.[team]?.label || team);
    const embed = new EmbedBuilder()
      .setTitle('Player UI')
      .setDescription(`Teams playing for: **${teamLabels.join(', ')}**\n\n${lines.join('\n')}`)
      .setColor(0x2ecc71)
      .setFooter({ text: 'Use event attendance buttons in team channels to confirm status.' });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};
