const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { loadDb } = require('../utils/database');

function getPlayerTeams(member, teamRoles) {
  return Object.entries(teamRoles)
    .filter(([, roles]) => member.roles.cache.has(roles.player))
    .map(([team]) => team);
}

function classifyEvent(title = '') {
  const lower = title.toLowerCase();
  if (lower.includes('match') || lower.includes('game') || lower.includes('fixture')) return 'Match';
  if (lower.includes('train') || lower.includes('practice') || lower.includes('session')) return 'Training';
  return 'Event';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('player')
    .setDescription('Open the player UI for upcoming training, matches, and events'),

  async execute(interaction, context) {
    const config = context.getConfig();
    const playerTeams = getPlayerTeams(interaction.member, config.roles);

    if (!playerTeams.length) {
      await interaction.reply({ content: 'You are not assigned as a player for any team.', ephemeral: true });
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
      ? events.map((event) => `• **${classifyEvent(event.title)}** — ${event.title} (${event.team})\n  ${new Date(event.date).toLocaleString()}`)
      : ['No upcoming sessions found for your teams.'];

    const embed = new EmbedBuilder()
      .setTitle('Player UI')
      .setDescription(`Teams: **${playerTeams.join(', ')}**\n\n${lines.join('\n')}`)
      .setColor(0x2ecc71)
      .setFooter({ text: 'Use event attendance buttons in team channels to confirm status.' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
