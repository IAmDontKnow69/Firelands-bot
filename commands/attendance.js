const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
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
        await interaction.reply({ content: 'Only coaches can run this command.', ephemeral: true });
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
        await interaction.reply({ content: 'No upcoming events were found for your team(s).', ephemeral: true });
        return;
      }

      const chunks = [];

      for (const event of relevantEvents) {
        const guildRole = interaction.guild.roles.cache.get(teamRoles[event.team].player);
        const playerIds = guildRole ? Array.from(guildRole.members.keys()) : [];
        const responses = event.responses || {};

        const attending = [];
        const confirmedNo = [];
        const pendingNo = [];

        for (const [userId, response] of Object.entries(responses)) {
          if (response.status === 'yes') attending.push(`<@${userId}>`);
          if (response.status === 'confirmed_no') {
            confirmedNo.push(`<@${userId}>${response.reason ? ` — ${response.reason}` : ''}`);
          }
          if (response.status === 'pending_no') {
            pendingNo.push(`<@${userId}>${response.reason ? ` — ${response.reason}` : ''}`);
          }
        }

        const respondedIds = new Set(Object.keys(responses));
        const noResponse = playerIds.filter((id) => !respondedIds.has(id)).map((id) => `<@${id}>`);

        chunks.push([
          `📅 **${event.title}**`,
          `🕒 ${new Date(event.date).toLocaleString()}`,
          '',
          '🟢 **Attending:**',
          attending.length ? attending.join('\n') : '*None*',
          '',
          '🔴 **Not Attending (Confirmed):**',
          confirmedNo.length ? confirmedNo.join('\n') : '*None*',
          '',
          '⚪ **Pending:**',
          pendingNo.length ? pendingNo.join('\n') : '*None*',
          '',
          '❓ **No Response:**',
          noResponse.length ? noResponse.join('\n') : '*None*'
        ].join('\n'));
      }

      const output = chunks.join('\n\n-------------------------\n\n');

      if (output.length > 1900) {
        await interaction.reply({ content: 'Attendance report is too long. Please narrow scope in future version.', ephemeral: true });
        return;
      }

      await interaction.reply({ content: output, ephemeral: true });
      return;
    }

    const team = interaction.options.getString('team', true);
    const dateInput = interaction.options.getString('date', true).trim();
    const parsedDate = new Date(`${dateInput}T00:00:00Z`);

    if (Number.isNaN(parsedDate.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      await interaction.reply({ content: 'Please use a valid date in YYYY-MM-DD format.', ephemeral: true });
      return;
    }

    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (parsedDate.getTime() < todayUtc) {
      await interaction.reply({ content: 'Date must be today or in the future.', ephemeral: true });
      return;
    }

    if (!hasPlayerRoleForTeam(interaction.member, teamRoles, team)) {
      await interaction.reply({ content: 'Only players from that team can update availability.', ephemeral: true });
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
        ephemeral: true
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
      ephemeral: true
    });
  }
};
