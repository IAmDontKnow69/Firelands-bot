const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, MessageFlags, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { loadDb, setFutureAvailability } = require('../utils/database');

function isCoach(member, teamRoles) {
  return Object.values(teamRoles).some((team) => member.roles.cache.has(team.coach));
}

function getCoachTeams(member, teamRoles) {
  return Object.entries(teamRoles)
    .filter(([, roles]) => member.roles.cache.has(roles.coach))
    .map(([team]) => team);
}

function hasPlayerRoleForTeam(member, teamRoles, team) {
  return !!teamRoles[team] && member.roles.cache.has(teamRoles[team].player);
}

function sanitizeChannelName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('attendance')
    .setDescription('Attendance reports and future availability updates')
    .addSubcommand((sub) =>
      sub
        .setName('report')
        .setDescription('Show attendance report for upcoming events (coaches only)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('unavailable')
        .setDescription('Mark yourself unavailable for a future date')
        .addStringOption((opt) =>
          opt
            .setName('team')
            .setDescription('Team for this availability update')
            .setRequired(true)
            .addChoices(
              { name: 'Mens', value: 'mens' },
              { name: 'Womens', value: 'womens' }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('date')
            .setDescription('Date in YYYY-MM-DD format')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('reason')
            .setDescription('Reason you are unavailable')
            .setRequired(true)
            .setMaxLength(500)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('available')
        .setDescription('Mark yourself available for a future date')
        .addStringOption((opt) =>
          opt
            .setName('team')
            .setDescription('Team for this availability update')
            .setRequired(true)
            .addChoices(
              { name: 'Mens', value: 'mens' },
              { name: 'Womens', value: 'womens' }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('date')
            .setDescription('Date in YYYY-MM-DD format')
            .setRequired(true)
        )
    ),

  async execute(interaction, context) {
    const subcommand = interaction.options.getSubcommand();
    const config = context.getConfig();
    const teamRoles = config.roles;

    if (subcommand === 'report') {
      if (!isCoach(interaction.member, teamRoles)) {
        await interaction.reply({ content: 'Only coaches can run this command.', flags: MessageFlags.Ephemeral });
        return;
      }

      const coachTeams = getCoachTeams(interaction.member, teamRoles);
      const db = loadDb();
      const now = new Date();

      const relevantEvents = Object.entries(db.events)
        .map(([eventId, event]) => ({ eventId, ...event }))
        .filter((event) => coachTeams.includes(event.team))
        .filter((event) => new Date(event.date) >= new Date(now.getTime() - 2 * 60 * 60 * 1000))
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      if (!relevantEvents.length) {
        await interaction.reply({ content: 'No upcoming events were found for your team(s).', flags: MessageFlags.Ephemeral });
        return;
      }

      const chunks = [];

      for (const event of relevantEvents) {
        const playerRole = interaction.guild.roles.cache.get(teamRoles[event.team].player);
        const coachRole = interaction.guild.roles.cache.get(teamRoles[event.team].coach);
        const playerIds = playerRole ? Array.from(playerRole.members.keys()) : [];
        const coachIds = coachRole ? Array.from(coachRole.members.keys()) : [];
        const responses = event.responses || {};

        const attendingPlayers = [];
        const attendingCoaches = [];
        const confirmedNoPlayers = [];
        const confirmedNoCoaches = [];
        const pendingNoPlayers = [];
        const pendingNoCoaches = [];

        for (const [userId, response] of Object.entries(responses)) {
          const isCoachForTeam = coachIds.includes(userId);
          const isPlayerForTeam = playerIds.includes(userId);
          if (!isCoachForTeam && !isPlayerForTeam) continue;

          if (response.status === 'yes') {
            if (isCoachForTeam) attendingCoaches.push(`<@${userId}>`);
            if (isPlayerForTeam) attendingPlayers.push(`<@${userId}>`);
          }
          if (response.status === 'confirmed_no') {
            if (isCoachForTeam) confirmedNoCoaches.push(`<@${userId}>${response.reason ? ` — ${response.reason}` : ''}`);
            if (isPlayerForTeam) confirmedNoPlayers.push(`<@${userId}>${response.reason ? ` — ${response.reason}` : ''}`);
          }
          if (response.status === 'pending_no') {
            if (isCoachForTeam) pendingNoCoaches.push(`<@${userId}>${response.reason ? ` — ${response.reason}` : ''}`);
            if (isPlayerForTeam) pendingNoPlayers.push(`<@${userId}>${response.reason ? ` — ${response.reason}` : ''}`);
          }
        }

        const respondedPlayerIds = new Set(Object.keys(responses).filter((id) => playerIds.includes(id)));
        const respondedCoachIds = new Set(Object.keys(responses).filter((id) => coachIds.includes(id)));
        const noResponse = playerIds.filter((id) => !respondedPlayerIds.has(id)).map((id) => `<@${id}>`);
        const coachesNoResponse = coachIds.filter((id) => !respondedCoachIds.has(id)).map((id) => `<@${id}>`);

        chunks.push([
          `📅 **${event.title}**`,
          `🕒 ${new Date(event.date).toLocaleString()}`,
          '',
          '🟢 **Attending (Players):**',
          attendingPlayers.length ? attendingPlayers.join('\n') : '*None*',
          '',
          '🟢 **Attending (Coaches):**',
          attendingCoaches.length ? attendingCoaches.join('\n') : '*None*',
          '',
          '🔴 **Not Attending (Confirmed Players):**',
          confirmedNoPlayers.length ? confirmedNoPlayers.join('\n') : '*None*',
          '',
          '🔴 **Not Attending (Confirmed Coaches):**',
          confirmedNoCoaches.length ? confirmedNoCoaches.join('\n') : '*None*',
          '',
          '⚪ **Pending (Players):**',
          pendingNoPlayers.length ? pendingNoPlayers.join('\n') : '*None*',
          '',
          '⚪ **Pending (Coaches):**',
          pendingNoCoaches.length ? pendingNoCoaches.join('\n') : '*None*',
          '',
          '❓ **No Response (Players):**',
          noResponse.length ? noResponse.join('\n') : '*None*',
          '',
          '❓ **No Response (Coaches):**',
          coachesNoResponse.length ? coachesNoResponse.join('\n') : '*None*'
        ].join('\n'));
      }

      const output = chunks.join('\n\n-------------------------\n\n');

      if (output.length > 1900) {
        await interaction.reply({ content: 'Attendance report is too long. Please narrow scope in future version.', flags: MessageFlags.Ephemeral });
        return;
      }

      const playerOptions = Array.from(new Set(
        coachTeams.flatMap((teamKey) => {
          const roleId = teamRoles[teamKey]?.player;
          const role = roleId ? interaction.guild.roles.cache.get(roleId) : null;
          return role ? Array.from(role.members.keys()) : [];
        })
      )).slice(0, 25).map((userId) => {
        const member = interaction.guild.members.cache.get(userId);
        return {
          label: (member?.displayName || member?.user?.username || userId).slice(0, 100),
          value: userId,
          description: `Open profile for ${member?.user?.tag || userId}`.slice(0, 100)
        };
      });

      const components = playerOptions.length
        ? [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('attendance_report_profile_select')
              .setPlaceholder('Open player profile from this report')
              .addOptions(playerOptions)
          )
        ]
        : [];

      await interaction.reply({ content: output, components, flags: MessageFlags.Ephemeral });
      return;
    }

    const team = interaction.options.getString('team', true);
    const dateInput = interaction.options.getString('date', true).trim();
    const parsedDate = new Date(`${dateInput}T00:00:00Z`);

    if (Number.isNaN(parsedDate.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      await interaction.reply({ content: 'Please use a valid date in YYYY-MM-DD format.', flags: MessageFlags.Ephemeral });
      return;
    }

    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (parsedDate.getTime() < todayUtc) {
      await interaction.reply({ content: 'Date must be today or in the future.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (!hasPlayerRoleForTeam(interaction.member, teamRoles, team)) {
      await interaction.reply({ content: 'Only players from that team can update availability.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (subcommand === 'available') {
      setFutureAvailability(interaction.user.id, team, dateInput, {
        status: 'available',
        reason: '',
        updatedAt: new Date().toISOString()
      });

      await interaction.reply({
        content: `✅ You are marked as **available** for **${team}** on **${dateInput}**.`,
        flags: MessageFlags.Ephemeral
      });
      await context.sendLog(`🟢 ${interaction.user.tag} marked available for ${team} on ${dateInput}.`);
      return;
    }

    const reason = interaction.options.getString('reason', true).trim();
    setFutureAvailability(interaction.user.id, team, dateInput, {
      status: 'unavailable',
      reason,
      updatedAt: new Date().toISOString()
    });

    const teamConfig = teamRoles[team];
    const displayName = interaction.member?.displayName || interaction.user.username;
    const channelName = sanitizeChannelName(`${displayName}-${dateInput}-future`);

    try {
      const discussionChannel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: config.channels.privateChatCategories?.[team] || config.channels.ticket || null,
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
            id: teamConfig.coach,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
          }
        ]
      });

      await discussionChannel.send([
        `Player's name: ${interaction.user}`,
        `Date of event: ${dateInput}`,
        'Name of event: Future event date not yet specified',
        `Reason for not attending: ${reason}`
      ].join('\n'));

      const staffRoomId = config.channels.staffRooms?.[team];
      if (staffRoomId) {
        const staffRoom = await interaction.guild.channels.fetch(staffRoomId).catch(() => null);
        if (staffRoom?.isTextBased()) {
          await staffRoom.send(`🚨 Future unavailability chat opened for ${interaction.user} (${dateInput}): <#${discussionChannel.id}>`);
        }
      }

      await context.sendLog(`🔴 ${interaction.user.tag} marked unavailable for ${team} on ${dateInput}. Chat: <#${discussionChannel.id}>`);
    } catch (error) {
      console.error('Failed to create future availability discussion channel:', error);
      await context.sendLog(`⚠️ Failed to create future unavailability chat for ${interaction.user.tag} (${team}, ${dateInput}).`);
    }

    await interaction.reply({
      content: `🔴 You are marked as **unavailable** for **${team}** on **${dateInput}**. Coaches will be notified in a private chat.`,
      flags: MessageFlags.Ephemeral
    });
  }
};
