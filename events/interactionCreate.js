const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');
const { loadDb, saveDb, setResponse } = require('../utils/database');
const { updateConfig } = require('../utils/config');
const { fetchCalendarEvents } = require('../utils/googleCalendar');
const coachCommand = require('../commands/coach');

const TEAM_LABELS = {
  mens: 'Mens Team',
  womens: "Women's Team"
};

function createAdminQuickActionRow() {
  return new ActionRowBuilder().addComponents(
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
}

function createTeamPickerRow(customId, placeholder = 'Choose a team') {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .addOptions([
        { label: TEAM_LABELS.mens, value: 'mens' },
        { label: TEAM_LABELS.womens, value: 'womens' }
      ])
  );
}

function createTeamConfigActionRow(team) {
  const label = TEAM_LABELS[team] || team;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`admin_team_config_action:${team}`)
      .setPlaceholder(`Configure ${label}`)
      .addOptions([
        { label: 'Set Player Role ID', value: 'player_role', description: `Set ${label} player role` },
        { label: 'Set Coach Role ID', value: 'coach_role', description: `Set ${label} coach role` },
        { label: 'Set Team Chat ID', value: 'team_chat', description: `Set ${label} team chat channel` },
        { label: 'Set Fixture Team', value: 'fixture_team', description: `Assign a fixture to ${label}` }
      ])
  );
}

function buildMonthGroupedEventLines(events, db, guild, teamRolesMap, config) {
  const sorted = [...events].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (!sorted.length) return ['No upcoming events found.'];

  const lines = [];
  let activeMonth = '';

  for (const event of sorted) {
    const date = new Date(event.date);
    const monthLabel = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    if (monthLabel !== activeMonth) {
      activeMonth = monthLabel;
      if (lines.length) lines.push('');
      lines.push(`__**${monthLabel}**__`);
    }

    const attendance = summarizeAttendance(event, db, guild, teamRolesMap);
    const shortTitle = event.title.length > 70 ? `${event.title.slice(0, 67)}...` : event.title;
    lines.push(`• ${date.toLocaleString()} — ${formatTeamLabel(event, config)} — **${shortTitle}** — ${attendance}`);
  }

  return lines;
}

function parseCustomId(customId) {
  const [action, eventId, userId] = customId.split(':');
  return { action, eventId, userId };
}

function hasRole(member, roleId) {
  return !!member.roles.cache.get(roleId);
}

function sanitizeChannelName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

function chunkLines(lines, size = 20) {
  const chunks = [];
  for (let i = 0; i < lines.length; i += size) chunks.push(lines.slice(i, i + size));
  return chunks;
}

function summarizeAttendance(event, db, guild, teamRolesMap) {
  if (!event.team || !teamRolesMap[event.team]?.player) return 'Attendance: n/a';

  const roleId = teamRolesMap[event.team].player;
  const role = guild.roles.cache.get(roleId);
  const totalPlayers = role ? role.members.size : 0;
  const responses = db.events[event.id]?.responses || {};
  const values = Object.values(responses);

  const yes = values.filter((response) => response.status === 'yes').length;
  const no = values.filter((response) => response.status === 'pending_no' || response.status === 'confirmed_no').length;
  const noResponse = Math.max(totalPlayers - yes - no, 0);

  return `✅ ${yes} | 🔴 ${no} | ❓ ${noResponse}`;
}

function formatTeamLabel(event, config) {
  if (!event.team) return '❔ Unknown Team';
  const emoji = config.teams?.[event.team]?.emoji || '🔹';
  const label = event.team === 'mens' ? 'Mens Team' : "Women's Team";
  return `${emoji} ${label}`;
}

module.exports = {
  name: 'interactionCreate',

  async execute(interaction, context) {
    const config = context.getConfig();
    const teamRolesMap = config.roles;

    if (interaction.isButton()) {
      const parsed = parseCustomId(interaction.customId);
      const db = loadDb();
      const event = db.events[parsed.eventId];

      if (!event) {
        await interaction.reply({ content: 'Event not found.', ephemeral: true });
        return;
      }

      const teamRoles = teamRolesMap[event.team];
      if (!teamRoles) {
        await interaction.reply({ content: 'Team roles are not configured for this event.', ephemeral: true });
        return;
      }

      if (parsed.action === 'attend_yes') {
        if (!hasRole(interaction.member, teamRoles.player)) {
          await interaction.reply({ content: 'Only players for this team can respond.', ephemeral: true });
          return;
        }

        setResponse(parsed.eventId, interaction.user.id, {
          status: 'yes',
          reason: '',
          confirmed: false
        });

        await interaction.reply({ content: '✅ You are marked as attending.', ephemeral: true });
        return;
      }

      if (parsed.action === 'attend_no') {
        if (!hasRole(interaction.member, teamRoles.player)) {
          await interaction.reply({ content: 'Only players for this team can respond.', ephemeral: true });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId(`absence_reason:${parsed.eventId}`)
          .setTitle('Not Attending');

        const reasonInput = new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason for not attending')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500);

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        await interaction.showModal(modal);
        return;
      }

      if (parsed.action === 'confirm_no') {
        const targetUserId = parsed.userId;

        if (!targetUserId) {
          await interaction.reply({ content: 'Invalid confirmation button.', ephemeral: true });
          return;
        }

        if (!hasRole(interaction.member, teamRoles.coach)) {
          await interaction.reply({ content: 'Only coaches can confirm absences.', ephemeral: true });
          return;
        }

        const existing = db.events[parsed.eventId]?.responses?.[targetUserId];

        if (!existing || existing.status !== 'pending_no') {
          await interaction.reply({ content: 'This absence is no longer pending.', ephemeral: true });
          return;
        }

        setResponse(parsed.eventId, targetUserId, {
          status: 'confirmed_no',
          confirmed: true
        });

        await interaction.reply({ content: `✅ Absence confirmed for <@${targetUserId}>.`, ephemeral: false });

        try {
          await interaction.channel.permissionOverwrites.edit(teamRoles.player, {
            SendMessages: false
          });
        } catch (error) {
          console.error('Failed to lock ticket channel:', error);
        }

        return;
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'coach_team_select') {
        const selectedTeam = interaction.values[0];
        const report = coachCommand.buildReport(interaction.guild, selectedTeam, teamRolesMap);

        const embed = new EmbedBuilder()
          .setTitle(`Coach UI — ${selectedTeam}`)
          .setDescription(report)
          .setColor(0x3498db);

        await interaction.update({ content: 'Coach report loaded.', embeds: [embed], components: [] });
        return;
      }

      if (interaction.customId === 'admin_quick_action') {
        const action = interaction.values[0];
        if (action === 'set_team_ids') {
          await interaction.update({
            content: 'Choose a team to configure role IDs, team chat ID, and fixture team.',
            embeds: [],
            components: [createTeamPickerRow('admin_team_config_select')]
          });
          return;
        }

        if (action === 'set_calendar_id') {
          const modal = new ModalBuilder()
            .setCustomId('admin_set_calendar_modal')
            .setTitle('Set Google Calendar ID');

          const calendarIdInput = new TextInputBuilder()
            .setCustomId('calendar_id')
            .setLabel('Google Calendar ID (email-like)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue(config.bot.calendarId || '')
            .setMaxLength(150);

          modal.addComponents(new ActionRowBuilder().addComponents(calendarIdInput));
          await interaction.showModal(modal);
          return;
        }

        if (action === 'view_google_events') {
          try {
            const db = loadDb();
            const events = await fetchCalendarEvents({
              calendarId: config.bot.calendarId,
              daysAhead: null,
              credentialsPath: config.bot.calendarCredentialsPath || ''
            });

            const lines = buildMonthGroupedEventLines(events, db, interaction.guild, teamRolesMap, config);

            const chunks = chunkLines(lines, 15);
            const embeds = chunks.map((chunk, index) => new EmbedBuilder()
              .setTitle(`Google Calendar — Club Fixtures (${events.length})`)
              .setDescription(chunk.join('\n'))
              .setColor(0x2ecc71)
              .setFooter({ text: `Page ${index + 1} of ${chunks.length}` }));

            await interaction.update({
              content: 'Loaded Google Calendar fixtures with attendance.',
              embeds: [embeds[0]],
              components: [createAdminQuickActionRow()]
            });

            for (let i = 1; i < embeds.length; i += 1) {
              await interaction.followUp({
                embeds: [embeds[i]],
                ephemeral: true
              });
            }
          } catch (error) {
            await interaction.update({
              content: `Could not load calendar events: ${error.message}`,
              embeds: [],
              components: [createAdminQuickActionRow()]
            });
          }
          return;
        }

        if (action === 'club_report') {
          await interaction.update({
            content: 'Run `/admin club-report` to open the full club attendance report.',
            embeds: [],
            components: [createAdminQuickActionRow()]
          });
          return;
        }

        await interaction.update({
          content: 'Use `/admin-config view` or `/admin-config set` for detailed configuration updates.',
          embeds: [],
          components: [createAdminQuickActionRow()]
        });
        return;
      }

      if (interaction.customId === 'admin_team_config_select') {
        const team = interaction.values[0];
        await interaction.update({
          content: `Configuring **${TEAM_LABELS[team]}**. Pick what to update.`,
          embeds: [],
          components: [createTeamConfigActionRow(team)]
        });
        return;
      }

      if (interaction.customId.startsWith('admin_team_config_action:')) {
        const team = interaction.customId.split(':')[1];
        const selectedAction = interaction.values[0];
        const teamLabel = TEAM_LABELS[team] || team;

        if (selectedAction === 'player_role' || selectedAction === 'coach_role') {
          const label = selectedAction === 'player_role' ? `${teamLabel} Player Role` : `${teamLabel} Coach Role`;
          const path = selectedAction === 'player_role' ? `roles.${team}.player` : `roles.${team}.coach`;
          const row = new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
              .setCustomId(`admin_set_role:${path}:${team}`)
              .setPlaceholder(`Choose ${label}`)
              .setMinValues(1)
              .setMaxValues(1)
          );

          await interaction.update({
            content: `Select the role to assign for **${label}**.`,
            embeds: [],
            components: [row]
          });
          return;
        }

        if (selectedAction === 'team_chat') {
          const row = new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId(`admin_set_channel:channels.teamChats.${team}:${team}`)
              .setPlaceholder(`Choose ${teamLabel} Team Chat`)
              .setChannelTypes(ChannelType.GuildText)
              .setMinValues(1)
              .setMaxValues(1)
          );

          await interaction.update({
            content: `Select the channel to assign for **${teamLabel} Team Chat**.`,
            embeds: [],
            components: [row]
          });
          return;
        }

        if (selectedAction === 'fixture_team') {
          const db = loadDb();
          const upcomingEvents = Object.entries(db.events)
            .map(([id, event]) => ({ id, ...event }))
            .filter((event) => new Date(event.date).getTime() >= Date.now())
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .slice(0, 25);

          if (!upcomingEvents.length) {
            await interaction.update({
              content: 'No upcoming fixtures found in synced events yet.',
              embeds: [],
              components: [createTeamConfigActionRow(team)]
            });
            return;
          }

          const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`admin_set_fixture_team:${team}`)
              .setPlaceholder(`Select fixture for ${teamLabel}`)
              .addOptions(
                upcomingEvents.map((event) => {
                  const when = new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  return {
                    label: `${when} — ${event.title}`.slice(0, 100),
                    value: event.id,
                    description: `Current: ${TEAM_LABELS[event.team] || 'Unassigned'}`.slice(0, 100)
                  };
                })
              )
          );

          await interaction.update({
            content: `Pick a fixture to assign to **${teamLabel}**.`,
            embeds: [],
            components: [row]
          });
          return;
        }
      }

      if (interaction.customId.startsWith('admin_set_fixture_team:')) {
        const team = interaction.customId.split(':')[1];
        const eventId = interaction.values[0];
        const db = loadDb();
        const target = db.events[eventId];

        if (!target) {
          await interaction.update({
            content: 'Fixture was not found in synced events.',
            embeds: [],
            components: [createTeamConfigActionRow(team)]
          });
          return;
        }

        target.team = team;
        saveDb(db);

        await interaction.update({
          content: `✅ Assigned **${target.title}** to **${TEAM_LABELS[team]}**.`,
          embeds: [],
          components: [createTeamConfigActionRow(team)]
        });
        return;
      }
    }

    if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('admin_set_role:')) {
      const [, configPath, team] = interaction.customId.split(':');
      const roleId = interaction.values[0];
      updateConfig(configPath, roleId);

      await interaction.update({
        content: `✅ Updated **${configPath}** to <@&${roleId}>.`,
        embeds: [],
        components: [createTeamConfigActionRow(team)]
      });
      return;
    }

    if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('admin_set_channel:')) {
      const [, configPath, team] = interaction.customId.split(':');
      const channelId = interaction.values[0];
      updateConfig(configPath, channelId);

      await interaction.update({
        content: `✅ Updated **${configPath}** to <#${channelId}>.`,
        embeds: [],
        components: [createTeamConfigActionRow(team)]
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('absence_reason:')) {
      const eventId = interaction.customId.split(':')[1];
      const db = loadDb();
      const event = db.events[eventId];

      if (!event) {
        await interaction.reply({ content: 'Event no longer exists.', ephemeral: true });
        return;
      }

      const teamRoles = teamRolesMap[event.team];
      if (!hasRole(interaction.member, teamRoles.player)) {
        await interaction.reply({ content: 'Only players for this team can respond.', ephemeral: true });
        return;
      }

      const reason = interaction.fields.getTextInputValue('reason').trim();

      setResponse(eventId, interaction.user.id, {
        status: 'pending_no',
        reason,
        confirmed: false
      });

      const shortEventId = eventId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
      const channelName = sanitizeChannelName(`ticket-${interaction.user.username}-${shortEventId}`);

      let ticketChannel;
      try {
        ticketChannel = await interaction.guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: config.channels.ticket || null,
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
              id: teamRoles.coach,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
            }
          ]
        });
      } catch (error) {
        console.error('Failed to create ticket channel:', error);
      }

      if (ticketChannel) {
        const confirmButton = new ButtonBuilder()
          .setCustomId(`confirm_no:${eventId}:${interaction.user.id}`)
          .setLabel('✅ Confirm Absence')
          .setStyle(ButtonStyle.Success);

        const row = new ActionRowBuilder().addComponents(confirmButton);

        await ticketChannel.send({
          content: `${interaction.user} cannot attend **${event.title}**\nReason: ${reason}`,
          components: [row]
        });
      }

      await interaction.reply({
        content: '🔴 Your absence was submitted and is pending coach confirmation.',
        ephemeral: true
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'admin_set_calendar_modal') {
      const calendarId = interaction.fields.getTextInputValue('calendar_id').trim();

      if (!calendarId) {
        await interaction.reply({ content: 'Calendar ID cannot be empty.', ephemeral: true });
        return;
      }

      updateConfig('bot.calendarId', calendarId);
      await interaction.reply({ content: `✅ Updated **bot.calendarId** to \`${calendarId}\`.`, ephemeral: true });
    }
  }
};
