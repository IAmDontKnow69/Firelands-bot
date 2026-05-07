const { SlashCommandBuilder, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { loadDb, getPlayerProfile, getActiveVacationsForUser } = require('../utils/database');
const { determineEventType, eventTypeLabel } = require('../utils/eventType');
const { formatPhoneLink } = require('../utils/phone');

function hasRole(member, storedRoles, roleId) {
  if (!roleId || roleId === 'ROLE_ID') return false;
  return Boolean(
    member?.roles?.cache?.has?.(roleId)
    || member?.roles?.cache?.get?.(roleId)
    || (Array.isArray(member?.roles) && member.roles.includes(roleId))
    || (Array.isArray(storedRoles) && storedRoles.includes(roleId))
  );
}

function getPlayerTeams(member, teamRoles = {}, storedRoles = []) {
  return Object.entries(teamRoles)
    .filter(([, roles]) => hasRole(member, storedRoles, roles.player))
    .map(([team]) => team);
}

async function resolveGuildMember(interaction, config) {
  if (interaction.member && interaction.guild) {
    return { guild: interaction.guild, member: interaction.member };
  }

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

async function buildPlayerHubResponse(interaction, context) {
      const config = context.getConfig();
      const userId = interaction.user.id;
      const profile = getPlayerProfile(userId) || {};
      const { member } = await resolveGuildMember(interaction, config);
      const playerTeams = getPlayerTeams(member, config.roles, profile.roles || []);

      if (!playerTeams.length) {
        return { content: 'You are not assigned as a player for any team.', flags: MessageFlags.Ephemeral };
      }

      const db = loadDb();
      const now = Date.now();

    const events = Object.entries(db.events)
      .map(([eventId, event]) => ({ eventId, ...event }))
      .filter((event) => playerTeams.includes(event.team))
      .filter((event) => new Date(event.date).getTime() >= now - 2 * 60 * 60 * 1000)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 5);

    const attendanceTotals = Object.values(db.events)
      .filter((event) => playerTeams.includes(event.team))
      .reduce((acc, event) => {
        const status = event.responses?.[userId]?.status;
        if (status === 'yes') acc.yes += 1;
        else if (['pending_no', 'confirmed_no'].includes(status)) acc.no += 1;
        else acc.noResponse += 1;
        return acc;
      }, { yes: 0, no: 0, noResponse: 0 });

    const activeVacations = getActiveVacationsForUser(userId);

      const nextGames = events.length
        ? events.map((event, index) => {
        const when = new Date(event.date).toLocaleString();
        const location = event.location || 'Location not set';
        const response = event.responses?.[userId];
        const statusText = response?.status === 'yes'
          ? '✅ Marked as attending'
          : (response?.onVacation
            ? `🌴 On vacation / ❌ Marked as not attending${response?.reason ? ` — ${response.reason}` : ''}`
            : (['pending_no', 'confirmed_no'].includes(response?.status) ? `❌ Marked as not attending${response?.reason ? ` — ${response.reason}` : ''}` : '❓ Not answered'));
        return `${index + 1}. **${event.title}**\n   Team: **${config.teams?.[event.team]?.label || event.team}** · ${eventTypeLabel(determineEventType(event, config))}\n   When: ${when}\n   Where: ${location}\n   Status: ${statusText}`;
        }).join('\n\n')
        : 'No upcoming games/events found for your teams.';

    const teamLabels = playerTeams.map((team) => config.teams?.[team]?.label || team);
      const embed = new EmbedBuilder()
      .setTitle('⚽ Player Hub')
      .setDescription([
        `Hi **${profile.customName || member?.displayName || interaction.member?.displayName || interaction.user.username}** 👋`,
        `Teams: **${teamLabels.join(', ')}**`,
        '',
        '### Attendance Summary',
        `✅ Attending: **${attendanceTotals.yes}**`,
        `🔴 Not Attending: **${attendanceTotals.no}**`,
        `❓ No Response: **${attendanceTotals.noResponse}**`,
        '',
        '### Next 5 Games',
        nextGames,
        '',
        '### Upcoming Vacation Times',
        activeVacations.length
          ? activeVacations.map((vac) => `• **${vac.title}** (${vac.team}) ${vac.startDate} → ${vac.endDate} — ${vac.status || 'pending'} — ${vac.reason || 'no reason'}`).join('\n')
          : 'No active vacations.'
      ].join('\n'))
      .setColor(0x2ecc71)
      .setThumbnail(profile.faceUrl || interaction.user.displayAvatarURL())
      .addFields(
        {
          name: 'Profile',
          value: [
            `• Discord: <@${userId}>`,
            `• Full name: ${profile.customName || interaction.user.username}`,
            `• First name: ${profile.firstName || 'not set'}`,
            `• Last name: ${profile.lastName || 'not set'}`,
            `• Gender: ${profile.gender || 'not set'}`,
            `• Nickname: ${profile.nickName || 'not set'}`,
            `• Joined discord server: ${member?.joinedAt ? member.joinedAt.toISOString().slice(0, 10) : 'unknown'}`,
            `• Phone number: ${formatPhoneLink(profile.phoneNumber)}`
          ].join('\n')
        }
      )
      .setFooter({ text: 'Use the buttons below to manage your profile, fixtures, vacations, and coach chat.' });

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('player_profile_manager').setLabel('🪪 Profile Manager').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('player_fixture_manager:0:future').setLabel('📅 Events/Fixtures').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('player_next_event_address').setLabel('📍 Next Event').setStyle(ButtonStyle.Primary)
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('player_vacation_open').setLabel('🌴 Vacation').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('player_talk_to_coaches').setLabel('💬 Talk to your coaches').setStyle(ButtonStyle.Secondary)
    );

      return { embeds: [embed], components: [row1, row2], flags: MessageFlags.Ephemeral };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('player')
    .setDescription('Open the player UI for profile, fixtures, attendance, and vacation status')
    .setDMPermission(true),
  buildPlayerHubResponse,

  async execute(interaction, context) {
    try {
      const payload = await buildPlayerHubResponse(interaction, context);
      await interaction.reply(payload);
    } catch (error) {
      const log = `[PLAYER_UI_ERROR] user=${interaction.user?.id} name=${interaction.user?.tag || interaction.user?.username} message="${error.message}"\n${error.stack}`;
      context.sendLog(log);
      await interaction.reply({
        content: `⚠️ /player feature is currently not working.\nPlease copy this log into Codex:\n\`\`\`\n${log.slice(0, 1500)}\n\`\`\``,
        flags: MessageFlags.Ephemeral
      }).catch(() => null);
    }
  }
};
