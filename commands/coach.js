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

function hasRole(member, storedRoles, roleId) {
  if (!roleId || roleId === 'ROLE_ID') return false;
  return Boolean(
    member?.roles?.cache?.has?.(roleId)
    || member?.roles?.cache?.get?.(roleId)
    || (Array.isArray(member?.roles) && member.roles.includes(roleId))
    || (Array.isArray(storedRoles) && storedRoles.includes(roleId))
  );
}

function getCoachTeams(member, teamRoles = {}, storedRoles = []) {
  return Object.entries(teamRoles)
    .filter(([, roles]) => hasRole(member, storedRoles, roles.coach))
    .map(([team]) => team);
}

function getTeamLabel(config = {}, team = '') {
  return config.teams?.[team]?.label || team;
}

async function resolveGuildMember(interaction, config) {
  if (interaction.member && interaction.guild) return { guild: interaction.guild, member: interaction.member };

  const guildId = config.bot?.guildId || process.env.DISCORD_GUILD_ID || interaction.guildId || '';
  let guild = guildId
    ? interaction.client.guilds.cache.get(guildId) || await interaction.client.guilds.fetch(guildId).catch(() => null)
    : null;

  if (!guild) {
    const cachedGuilds = Array.from(interaction.client.guilds.cache.values());
    guild = cachedGuilds.length === 1 ? cachedGuilds[0] : null;
  }

  const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
  return { guild, member };
}

function buildReport(guild, team, teamRoles, config = {}) {
  const db = loadDb();
  const now = Date.now();

  const events = Object.entries(db.events)
    .map(([eventId, event]) => ({ eventId, ...event }))
    .filter((event) => event.team === team)
    .filter((event) => new Date(event.date).getTime() >= now - 2 * 60 * 60 * 1000)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 5);

  const playerRoleId = teamRoles[team]?.player;
  const coachRoleId = teamRoles[team]?.coach;
  const playerRole = guild?.roles?.cache?.get(playerRoleId);
  const coachRole = guild?.roles?.cache?.get(coachRoleId);
  const storedPlayers = Object.entries(db.players || {})
    .filter(([, profile]) => Array.isArray(profile.roles) && profile.roles.includes(playerRoleId))
    .map(([userId]) => userId);
  const storedCoaches = Object.entries(db.players || {})
    .filter(([, profile]) => Array.isArray(profile.roles) && profile.roles.includes(coachRoleId))
    .map(([userId]) => userId);
  const playerIds = Array.from(new Set([...(playerRole ? Array.from(playerRole.members.keys()) : []), ...storedPlayers]));
  const coachIds = Array.from(new Set([...(coachRole ? Array.from(coachRole.members.keys()) : []), ...storedCoaches]));

  if (!events.length) return `No upcoming events for **${getTeamLabel(config, team)}**.`;

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
    const profile = getPlayerProfile(interaction.user.id) || {};
    const { guild, member } = await resolveGuildMember(interaction, config);
    const coachTeams = getCoachTeams(member, config.roles, profile.roles || []);

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
          description: `Open attendance + management for ${getTeamLabel(config, team)}`
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
    const coachTitle = profile.coachPositions?.[team] || 'Coach';
    const report = buildReport(guild, team, config.roles, config);

    const embed = new EmbedBuilder()
      .setTitle(`Coach UI — ${teamLabel}`)
      .setDescription([
        `Hi **${member?.displayName || interaction.member?.displayName || interaction.user.username}** (${coachTitle}) 👋`,
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

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`coach_manage_profile:${team}`).setLabel('🧢 Coach Profile').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`coach_manage_players:${team}`).setLabel('👥 Player Manager').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`coach_manage_events:${team}`).setLabel('📅 Event Manager').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`coach_next_event:${team}`).setLabel('➡️ Next Event').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`coach_manage_vacation:${team}`).setLabel('🌴 Vacation').setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`coach_open_player_chat:${team}`).setLabel('💬 Chat With Player').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`coach_set_team_badge:${team}`).setLabel('🛡️ Team Badge').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`coach_set_captain:${team}`).setLabel('🅒 Set Captain').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`coach_set_vice_captain:${team}`).setLabel('🅥 Set Vice Captain').setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [embed], components: [row1, row2], flags: MessageFlags.Ephemeral });
  },

  buildReport
};
