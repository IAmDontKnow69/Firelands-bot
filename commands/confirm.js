const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');
const { loadDb, setResponse, deleteAbsenceTicket } = require('../utils/database');
const { syncAllToSheet } = require('../utils/googleSheetsSync');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('confirm')
    .setDescription('Coach/staff: confirm an absence from inside a private attendance chat'),

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

    setResponse(ticket.eventId, ticket.playerId, {
      status: 'confirmed_no',
      confirmed: true,
      confirmedBy: interaction.user.id,
      confirmedAt: new Date().toISOString()
    });

    const latestConfig = context.getConfig();
    if (latestConfig.googleSync?.enabled) {
      try {
        await syncAllToSheet(latestConfig, loadDb());
      } catch (error) {
        await context.sendLog(`⚠️ Google Sheets sync failed after /confirm: ${error.message}`);
      }
    }

    deleteAbsenceTicket(interaction.channelId);

    await interaction.editReply({ content: `✅ Confirmed absence for <@${ticket.playerId}>.` });
    const member = await interaction.guild.members.fetch(ticket.playerId).catch(() => null);
    await member?.send(`✅ Your not-attending request for **${event.title}** (${new Date(event.date).toISOString().slice(0, 10)}) was confirmed by a coach.`).catch(() => null);

    await context.sendLog(
      `✅ Absence confirmed by ${interaction.user.tag} for <@${ticket.playerId}> on **${event.title}** (${new Date(event.date).toISOString().slice(0, 10)}).`
    );

    setTimeout(async () => {
      try {
        await interaction.channel.delete('Absence confirmed by staff/coach');
      } catch (error) {
        console.error('Failed deleting confirmed absence channel:', error);
      }
    }, 3000);
  }
};
