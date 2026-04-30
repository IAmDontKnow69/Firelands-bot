const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');
const { loadDb, getPlayerProfile, getActiveVacationsForUser } = require('../utils/database');

function getCoachTeams(member, teamRoles) {
  return Object.entries(teamRoles)
    .filter(([, roles]) => member.roles.cache.has(roles.coach))
    .map(([team]) => team);
}

async function resolveGuildMember(interaction, config) {
  if (interaction.member && interaction.guild) return { guild: interaction.guild, member: interaction.member };
  const guildId = config.bot?.guildId;
  if (!guildId) return { guild: null, member: null };
  const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);
  const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
  return { guild, member };
}

function buildReport(guild, team, teamRoles) {
  const db = loadDb();
  const now = Date.now();

  const events = Object.entries(db.events)
    .map(([eventId, event]) => ({ eventId, ...event }))
    .filter((event) => event.team === team)
    .filter((event) => new Date(event.date).getTime() >= now - 2 * 60 * 60 * 1000)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 5);

  const playerRole = guild.roles.cache.get(teamRoles[team].player);
  const coachRole = guild.roles.cache.get(teamRoles[team].coach);
  const playerIds = playerRole ? Array.from(playerRole.members.keys()) : [];
  const coachIds = coachRole ? Array.from(coachRole.members.keys()) : [];

  if (!events.length) return `No upcoming events for **${team}**.`;

  return events.map((event) => {
    const responses = event.responses || {};
    const attendingPlayers = Object.entries(responses).filter(([userId, value]) => playerIds.includes(userId) && value.status === 'yes').length;
    const unavailablePlayers = Object.entries(responses).filter(([userId, value]) => playerIds.includes(userId) && ['pending_no', 'confirmed_no'].includes(value.status)).length;
    const noResponse = Math.max(playerIds.length - Object.keys(responses).filter((id) => playerIds.includes(id)).length, 0);

    const onVacation = playerIds.filter((id) => getActiveVacationsForUser(id).some((vac) => vac.team === team)).length;

    return [
      `**${event.title}** (${new Date(event.date).toLocaleString()})`,
      `🟢 Attending (Players): ${attendingPlayers}`,
      `🔴 Not attending (Players): ${unavailablePlayers}`,
      `🌴 On Vacation: ${onVacation}`,
      `❓ No response (Players): ${noResponse}`,
      `🧢 Coaches in Team: ${coachIds.length}`
    ].join('\n');
  }).join('\n\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coach')
    .setDescription('Open the coach UI for attendance reports, player management, and vacations')
    .setDMPermission(true),

  async execute(interaction, context) {
    const config = context.getConfig();
    const { guild, member } = await resolveGuildMember(interaction, config);
    const coachTeams = member ? getCoachTeams(member, config.roles) : [];

    if (!coachTeams.length) {
      await interaction.reply({ content: 'You are not assigned as a coach for any team.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (coachTeams.length > 1) {
      const select = new StringSelectMenuBuilder()
        .setCustomId('coach_team_select')
        .setPlaceholder('Select your team')
        .addOptions(coachTeams.map((team) => ({
          label: config.teams?.[team]?.label || (team[0].toUpperCase() + team.slice(1)),
          value: team,
          description: `Open attendance + management for ${team}`
        })));

      const row = new ActionRowBuilder().addComponents(select);

      await interaction.reply({
        content: 'Select the team you want to manage.',
        components: [row],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const team = coachTeams[0];
    const teamLabel = config.teams?.[team]?.label || team;
    const profile = getPlayerProfile(interaction.user.id) || {};
    const coachTitle = profile.coachPositions?.[team] || 'Coach';
    const report = buildReport(guild, team, config.roles);

    const embed = new EmbedBuilder()
      .setTitle(`Coach UI — ${teamLabel}`)
      .setDescription([
        `Hi **${interaction.member?.displayName || interaction.user.username}** (${coachTitle}) 👋`,
        '',
        `You are viewing **${teamLabel}** status. This panel shows next-games attendance and management quick actions.`,
        '',
        '### Next Games Attendance',
        report,
        '',
        '### Upcoming Vacation Times',
        'Use the **Vacation** button to manage your own and player vacations for this team.'
      ].join('\n'))
      .setColor(0x3498db);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`coach_manage_players:${team}`).setLabel('👥 Player Manager').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`coach_manage_attendance:${team}`).setLabel('📋 Next Games Attendance').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`coach_manage_vacation:${team}`).setLabel('🌴 Vacation').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`coach_set_team_badge:${team}`).setLabel('🛡️ Team Badge').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`coach_team_delivery_mode:${team}`).setLabel('📣 Team Delivery').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`coach_set_captain:${team}`).setLabel('🅒 Set Captain').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`coach_set_vice_captain:${team}`).setLabel('🅥 Set Vice Captain').setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
  },

  buildReport
};
