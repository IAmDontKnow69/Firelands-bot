const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { loadConfig, updateConfig } = require('../utils/config');
const { loadDb } = require('../utils/database');
const { syncAllToSheet } = require('../utils/googleSheetsSync');
const { hasAdminAccess, adminAccessMessage } = require('../utils/adminAccess');

const FIELD_MAP = {
  bot_token_reference: 'bot.tokenReference',
  mens_player_role_id: 'roles.mens.player',
  womens_player_role_id: 'roles.womens.player',
  mens_coach_role_id: 'roles.mens.coach',
  womens_coach_role_id: 'roles.womens.coach',
  events_channel_id: 'channels.events',
  logs_channel_id: 'channels.logs',
  ticket_channel_id: 'channels.ticket',
  admin_channel_id: 'channels.admin',
  bot_commands_channel_id: 'channels.botCommands',
  admin_role_id: 'bot.adminRoleId',
  mens_team_channel_id: 'channels.teamChats.mens',
  womens_team_channel_id: 'channels.teamChats.womens',
  mens_staff_room_id: 'channels.staffRooms.mens',
  womens_staff_room_id: 'channels.staffRooms.womens',
  mens_private_chat_category_id: 'channels.privateChatCategories.mens',
  womens_private_chat_category_id: 'channels.privateChatCategories.womens',
  google_sync_enabled: 'googleSync.enabled',
  google_spreadsheet_id: 'googleSync.spreadsheetId'
};

function isSnowflake(value) {
  return /^\d{8,25}$/.test(value);
}

function validateField(field, value) {
  if (field === 'bot_token_reference') return value.length >= 10;
  if (field === 'google_sync_enabled') return ['true', 'false'].includes(String(value).toLowerCase());
  if (field === 'google_spreadsheet_id') return String(value).trim().length > 10;
  return isSnowflake(value);
}

function findRoleByName(guild, name) {
  if (!guild) return null;
  const lower = name.toLowerCase();
  const roles = guild.roles.cache
    .filter((role) => role.name.toLowerCase().includes(lower))
    .sort((a, b) => a.name.length - b.name.length);
  return roles.first() || null;
}

function findChannelByName(guild, name) {
  if (!guild) return null;
  const lower = name.toLowerCase();
  const channels = guild.channels.cache
    .filter((channel) => channel.name && channel.name.toLowerCase().includes(lower))
    .sort((a, b) => a.name.length - b.name.length);
  return channels.first() || null;
}

function formatConfigId(value) {
  return !value || value === 'ROLE_ID' ? 'not set' : value;
}

module.exports = {
  FIELD_MAP,
  validateField,

  async handleView(interaction) {
    const config = loadConfig();
    const message = [
      '**Firelands United Bot Configuration**',
      '',
      `Bot Token Reference: ${config.bot.tokenReference ? '`set`' : '`not set`'}`,
      `Mens Player Role: ${formatConfigId(config.roles.mens.player)}`,
      `Womens Player Role: ${formatConfigId(config.roles.womens.player)}`,
      `Mens Coach Role: ${formatConfigId(config.roles.mens.coach)}`,
      `Womens Coach Role: ${formatConfigId(config.roles.womens.coach)}`,
      `Events Channel: ${config.channels.events || 'not set'}`,
      `Mens Team Chat Channel: ${config.channels.teamChats?.mens || 'not set'}`,
      `Womens Team Chat Channel: ${config.channels.teamChats?.womens || 'not set'}`,
      `Mens Staff Room Channel: ${config.channels.staffRooms?.mens || 'not set'}`,
      `Womens Staff Room Channel: ${config.channels.staffRooms?.womens || 'not set'}`,
      `Mens Private Chat Category: ${config.channels.privateChatCategories?.mens || 'not set'}`,
      `Womens Private Chat Category: ${config.channels.privateChatCategories?.womens || 'not set'}`,
      `Logs Channel: ${config.channels.logs || 'not set'}`,
      `Admin Channel: ${config.channels.admin || 'not set'}`,
      `Bot Commands Channel: ${config.channels.botCommands || 'not set'}`,
      `Admin Role: ${config.bot.adminRoleId || 'not set'}`,
      `Ticket Channel/Category: ${config.channels.ticket || 'not set'}`,
      `Mens Label Emoji: ${config.teams?.mens?.emoji || 'not set'}`,
      `Womens Label Emoji: ${config.teams?.womens?.emoji || 'not set'}`,
      `Google Sync Enabled: ${config.googleSync?.enabled ? 'true' : 'false'}`,
      `Google Spreadsheet: ${config.googleSync?.spreadsheetId || 'not set'}`,
      '',
      '_Note: Bot token changes are stored for restart/reference and do not hot-swap runtime auth._'
    ].join('\n');

    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
  },

  data: new SlashCommandBuilder()
    .setName('admin-config')
    .setDescription('View or update Firelands United bot configuration')
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('View current bot configuration')
    )
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Update a specific configuration field')
        .addStringOption((opt) =>
          opt
            .setName('field')
            .setDescription('Configuration field to update')
            .setRequired(true)
            .addChoices(
              { name: 'Bot token reference', value: 'bot_token_reference' },
              { name: 'Mens player role ID', value: 'mens_player_role_id' },
              { name: 'Womens player role ID', value: 'womens_player_role_id' },
              { name: 'Mens coach role ID', value: 'mens_coach_role_id' },
              { name: 'Womens coach role ID', value: 'womens_coach_role_id' },
              { name: 'Events channel ID', value: 'events_channel_id' },
              { name: 'Logs channel ID', value: 'logs_channel_id' },
              { name: 'Admin channel ID', value: 'admin_channel_id' },
              { name: 'Bot commands channel ID', value: 'bot_commands_channel_id' },
              { name: 'Admin role ID', value: 'admin_role_id' },
              { name: 'Ticket channel/category ID', value: 'ticket_channel_id' },
              { name: 'Mens team chat channel ID', value: 'mens_team_channel_id' },
              { name: 'Womens team chat channel ID', value: 'womens_team_channel_id' },
              { name: 'Mens staff room channel ID', value: 'mens_staff_room_id' },
              { name: 'Womens staff room channel ID', value: 'womens_staff_room_id' },
              { name: 'Mens private chat category ID', value: 'mens_private_chat_category_id' },
              { name: 'Womens private chat category ID', value: 'womens_private_chat_category_id' },
              { name: 'Google sync enabled (true/false)', value: 'google_sync_enabled' },
              { name: 'Google spreadsheet ID/URL', value: 'google_spreadsheet_id' }
            )
        )
        .addStringOption((opt) =>
          opt
            .setName('value')
            .setDescription('New value (for token reference or manual ID/name entry)')
            .setRequired(false)
        )
        .addRoleOption((opt) =>
          opt
            .setName('role')
            .setDescription('Select a role (supports type-ahead by role name)')
            .setRequired(false)
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Select a channel/category (supports type-ahead by name)')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('sync-google')
        .setDescription('Force-sync fixtures, attendance, and config to Google Sheets')
        .addStringOption((opt) =>
          opt
            .setName('spreadsheet')
            .setDescription('Optional spreadsheet ID or full URL')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const config = loadConfig();
    if (!hasAdminAccess(interaction.member, config)) {
      await interaction.reply({ content: adminAccessMessage(config), flags: MessageFlags.Ephemeral });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'view') {
      await module.exports.handleView(interaction);
      return;
    }

    if (subcommand === 'sync-google') {
      const spreadsheetInput = interaction.options.getString('spreadsheet');

      if (spreadsheetInput?.trim()) {
        updateConfig('googleSync.spreadsheetId', spreadsheetInput.trim());
      }

      updateConfig('googleSync.enabled', true);

      const latestConfig = loadConfig();
      const db = loadDb();

      try {
        const result = await syncAllToSheet(latestConfig, db);
        if (!result.ok) {
          await interaction.reply({
            content: 'Could not sync because spreadsheet ID is not configured.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        await interaction.reply({
          content: `✅ Synced fixtures, attendance, command log, and config to Google Sheets (\`${result.spreadsheetId}\`).`,
          flags: MessageFlags.Ephemeral
        });
      } catch (error) {
        await interaction.reply({
          content: `❌ Google sync failed: ${error.message}`,
          flags: MessageFlags.Ephemeral
        });
      }

      return;
    }

    const field = interaction.options.getString('field', true);
    const rawValue = interaction.options.getString('value');
    const selectedRole = interaction.options.getRole('role');
    const selectedChannel = interaction.options.getChannel('channel');
    let value = rawValue ? rawValue.trim() : '';

    if (field === 'bot_token_reference') {
      if (!value) {
        await interaction.reply({
          content: 'Please provide a token reference in the `value` option.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      if (!validateField(field, value)) {
        await interaction.reply({ content: 'Invalid token reference format.', flags: MessageFlags.Ephemeral });
        return;
      }
    } else if (field.endsWith('role_id')) {
      if (selectedRole) {
        value = selectedRole.id;
      } else if (value) {
        const matchedRole = isSnowflake(value) ? interaction.guild?.roles.cache.get(value) : findRoleByName(interaction.guild, value);
        if (matchedRole) value = matchedRole.id;
      }

      if (!validateField(field, value)) {
        await interaction.reply({
          content: 'Please select a valid role using the `role` option or provide a valid role ID/name.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
    } else {
      if (selectedChannel) {
        value = selectedChannel.id;
      } else if (value) {
        const matchedChannel = isSnowflake(value) ? interaction.guild?.channels.cache.get(value) : findChannelByName(interaction.guild, value);
        if (matchedChannel) value = matchedChannel.id;
      }

      if (!validateField(field, value)) {
        await interaction.reply({
          content: 'Please select a valid channel/category using the `channel` option or provide a valid channel ID/name.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
    }

    const configPath = FIELD_MAP[field];
    const normalizedValue = field === 'google_sync_enabled'
      ? String(value).toLowerCase() === 'true'
      : value;
    updateConfig(configPath, normalizedValue);

    const latestConfig = loadConfig();
    if (latestConfig.googleSync?.enabled) {
      try {
        await syncAllToSheet(latestConfig, loadDb());
      } catch (error) {
        await interaction.reply({
          content: `✅ Updated **${field}**. ⚠️ Google sync warning: ${error.message}`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
    }

    await interaction.reply({
      content: `✅ Updated **${field}**. ${field === 'bot_token_reference' ? 'Restart bot to use new token.' : ''}`,
      flags: MessageFlags.Ephemeral
    });
  }
};
