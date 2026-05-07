const { SlashCommandBuilder, ChannelType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { loadDb, setResponse, setAbsenceTicket } = require('../utils/database');
const { syncAllToSheet } = require('../utils/googleSheetsSync');

function getCompactDateLabel(eventDate) {
  const date = new Date(eventDate);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const yy = String(date.getUTCFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

function createAbsenceLogRow(ticketChannelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`absence_ticket_log:${ticketChannelId}`)
      .setLabel('📜 Absence Log')
      .setStyle(ButtonStyle.Secondary)
  );
}

function formatClosedAbsenceNotification(ticket = {}, event = {}) {
  const playerName = ticket.playerName || `<@${ticket.playerId}>`;
  const eventLabel = event?.title || ticket.eventId || 'Unknown event';
  const dateLabel = event?.date ? getCompactDateLabel(event.date) : 'unknown date';
  return `✅ Not attending confirmed for ${playerName} by ${ticket.coachName || 'staff'} on ${eventLabel} (${dateLabel}).`;
}


async function collectChatLog(channel) {
  const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!fetched) return [];
  return Array.from(fetched.values())
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map((msg) => {
      const date = new Date(msg.createdTimestamp);
      return {
        ts: date.toISOString(),
        day: date.toISOString().slice(0, 10),
        time: date.toISOString().slice(11, 16),
        userId: msg.author?.id || '',
        name: msg.member?.displayName || msg.author?.username || 'unknown',
        message: msg.content || '(no text)'
      };
    });
}

async function updateAbsenceNotifications(interaction, ticket, event) {
  const notices = [ticket.staffNotification, ticket.adminNotification].filter(Boolean);
  for (const notice of notices) {
    const noticeChannel = await interaction.guild.channels.fetch(notice.channelId).catch(() => null);
    if (!noticeChannel?.isTextBased()) continue;
    const message = await noticeChannel.messages.fetch(notice.messageId).catch(() => null);
    if (!message) continue;
    await message.edit({
      content: formatClosedAbsenceNotification(ticket, event),
      components: [createAbsenceLogRow(interaction.channelId)]
    }).catch(() => null);
  }
}


module.exports = {
  data: new SlashCommandBuilder()
    .setName('confirm')
    .setDescription('Coach/staff: confirm an absence from inside a private attendance chat')
    .setDMPermission(false),

  async execute(interaction, context) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
      await interaction.editReply({ content: 'Run this in the private absence text channel.' });
      return;
    }

    const db = loadDb();
    const ticket = db.absenceTickets?.[interaction.channelId];

    if (!ticket) {
      await interaction.editReply({ content: 'This channel is not linked to a pending attendance ticket.' });
      return;
    }

    const event = db.events[ticket.eventId];
    if (!event) {
      await interaction.editReply({ content: 'The related event could not be found.' });
      return;
    }

    const teamRoles = context.getConfig().roles?.[event.team];
    if (!teamRoles?.coach || !interaction.member.roles.cache.has(teamRoles.coach)) {
      await interaction.editReply({ content: 'Only coaches/staff for this team can confirm this absence.' });
      return;
    }

    const coachName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username || interaction.user.tag;
    const chatLog = await collectChatLog(interaction.channel);
    const closedTicket = {
      ...ticket,
      status: 'closed',
      coachDecision: 'confirmed_not_attending',
      coachId: interaction.user.id,
      coachName,
      closedAt: new Date().toISOString(),
      closedReason: 'Coach confirmed not attending.',
      ...(chatLog.length ? { chatLog } : {})
    };

    setResponse(ticket.eventId, ticket.playerId, {
      status: 'confirmed_no',
      confirmed: true,
      confirmedBy: interaction.user.id,
      confirmedAt: new Date().toISOString(),
      coachId: interaction.user.id,
      coachName
    });
    setAbsenceTicket(interaction.channelId, closedTicket);

    const latestConfig = context.getConfig();
    if (latestConfig.googleSync?.enabled) {
      try {
        await syncAllToSheet(latestConfig, loadDb());
      } catch (error) {
        await context.sendLog(`⚠️ Google Sheets sync failed after /confirm: ${error.message}`);
      }
    }

    await updateAbsenceNotifications(interaction, closedTicket, event);

    await interaction.editReply({ content: `✅ Confirmed absence for <@${ticket.playerId}>.` });
    if (!closedTicket.adminNotification) {
      await context.sendLog(
        `🔴 Not attending confirmed for ${closedTicket.playerName || `<@${ticket.playerId}>`} by ${coachName} on **${event.title}**.`
      );
    }

    setTimeout(async () => {
      try {
        await interaction.channel.delete('Absence confirmed by staff/coach');
      } catch (error) {
        console.error('Failed deleting confirmed absence channel:', error);
      }
    }, 3000);
  }
};
