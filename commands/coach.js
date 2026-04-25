const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags
} = require('discord.js');
const { loadDb } = require('../utils/database');

function getCoachTeams(member, teamRoles) {
  return Object.entries(teamRoles)
    .filter(([, roles]) => member.roles.cache.has(roles.coach))
    .map(([team]) => team);
}

function buildReport(guild, team, teamRoles) {
  const db = loadDb();
  const now = Date.now();

  const events = Object.entries(db.events)
    .map(([eventId, event]) => ({ eventId, ...event }))
    .filter((event) => event.team === team)
    .filter((event) => new Date(event.date).getTime() >= now - 2 * 60 * 60 * 1000)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 8);

  const playerRole = guild.roles.cache.get(teamRoles[team].player);
  const coachRole = guild.roles.cache.get(teamRoles[team].coach);
  const playerIds = playerRole ? Array.from(playerRole.members.keys()) : [];
  const coachIds = coachRole ? Array.from(coachRole.members.keys()) : [];

  if (!events.length) {
    return `No upcoming events for **${team}**.`;
  }

  return events.map((event) => {
    const responses = event.responses || {};
    const attendingPlayers = Object.entries(responses).filter(([userId, value]) => playerIds.includes(userId) && value.status === 'yes').length;
    const attendingCoaches = Object.entries(responses).filter(([userId, value]) => coachIds.includes(userId) && value.status === 'yes').length;
    const unavailablePlayers = Object.entries(responses).filter(([userId, value]) => playerIds.includes(userId) && ['pending_no', 'confirmed_no'].includes(value.status)).length;
    const unavailableCoaches = Object.entries(responses).filter(([userId, value]) => coachIds.includes(userId) && ['pending_no', 'confirmed_no'].includes(value.status)).length;
    const respondedPlayerIds = Object.keys(responses).filter((id) => playerIds.includes(id));
    const respondedCoachIds = Object.keys(responses).filter((id) => coachIds.includes(id));
    const noResponse = Math.max(playerIds.length - respondedPlayerIds.length, 0);
    const noResponseCoaches = Math.max(coachIds.length - respondedCoachIds.length, 0);

    return [
      `**${event.title}** (${new Date(event.date).toLocaleString()})`,
      `🟢 Attending (Players): ${attendingPlayers}`,
      `🟢 Attending (Coaches): ${attendingCoaches}`,
      `🔴 Not attending (Players): ${unavailablePlayers}`,
      `🔴 Not attending (Coaches): ${unavailableCoaches}`,
      `❓ No response (Players): ${noResponse}`,
      `❓ No response (Coaches): ${noResponseCoaches}`
    ].join('\n');
  }).join('\n\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coach')
    .setDescription('Open the coach UI for attendance reports'),

  async execute(interaction, context) {
    const config = context.getConfig();
    const coachTeams = getCoachTeams(interaction.member, config.roles);

    if (!coachTeams.length) {
      await interaction.reply({ content: 'You are not assigned as a coach for any team.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (coachTeams.length > 1) {
      const select = new StringSelectMenuBuilder()
        .setCustomId('coach_team_select')
        .setPlaceholder('Select your team')
        .addOptions(coachTeams.map((team) => ({
          label: team[0].toUpperCase() + team.slice(1),
          value: team,
          description: `Open attendance report for ${team}`
        })));

      const row = new ActionRowBuilder().addComponents(select);

      await interaction.reply({
        content: 'Select the team you want to view before opening attendance.',
        components: [row],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const report = buildReport(interaction.guild, coachTeams[0], config.roles);
    const embed = new EmbedBuilder()
      .setTitle(`Coach UI — ${coachTeams[0]}`)
      .setDescription(report)
      .setColor(0x3498db);

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },

  buildReport
};
