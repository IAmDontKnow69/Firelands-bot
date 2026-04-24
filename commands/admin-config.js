const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { loadConfig, updateConfig } = require('../utils/config');

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
  mens_team_channel_id: 'channels.teamChats.mens',
  womens_team_channel_id: 'channels.teamChats.womens',
  mens_staff_room_id: 'channels.staffRooms.mens',
  womens_staff_room_id: 'channels.staffRooms.womens',
  mens_private_chat_category_id: 'channels.privateChatCategories.mens',
  womens_private_chat_category_id: 'channels.privateChatCategories.womens'
};

function isSnowflake(value) {
  return /^\d{8,25}$/.test(value);
}

function validateField(field, value) {
  if (field === 'bot_token_reference') return value.length >= 10;
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin-config')
    .setDescription('View or update Firelands United bot configuration')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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
              { name: 'Ticket channel/category ID', value: 'ticket_channel_id' },
              { name: 'Mens team chat channel ID', value: 'mens_team_channel_id' },
              { name: 'Womens team chat channel ID', value: 'womens_team_channel_id' },
              { name: 'Mens staff room channel ID', value: 'mens_staff_room_id' },
              { name: 'Womens staff room channel ID', value: 'womens_staff_room_id' },
              { name: 'Mens private chat category ID', value: 'mens_private_chat_category_id' },
              { name: 'Womens private chat category ID', value: 'womens_private_chat_category_id' }
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
    ),

  async execute(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: 'Administrator permission is required.', ephemeral: true });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'view') {
      const config = loadConfig();
      const message = [
        '**Firelands United Bot Configuration**',
        '',
        `Bot Token Reference: ${config.bot.tokenReference ? '`set`' : '`not set`'}`,
        `Mens Player Role: ${config.roles.mens.player || 'not set'}`,
        `Womens Player Role: ${config.roles.womens.player || 'not set'}`,
        `Mens Coach Role: ${config.roles.mens.coach || 'not set'}`,
        `Womens Coach Role: ${config.roles.womens.coach || 'not set'}`,
        `Events Channel: ${config.channels.events || 'not set'}`,
        `Mens Team Chat Channel: ${config.channels.teamChats?.mens || 'not set'}`,
        `Womens Team Chat Channel: ${config.channels.teamChats?.womens || 'not set'}`,
        `Mens Staff Room Channel: ${config.channels.staffRooms?.mens || 'not set'}`,
        `Womens Staff Room Channel: ${config.channels.staffRooms?.womens || 'not set'}`,
        `Mens Private Chat Category: ${config.channels.privateChatCategories?.mens || 'not set'}`,
        `Womens Private Chat Category: ${config.channels.privateChatCategories?.womens || 'not set'}`,
        `Logs Channel: ${config.channels.logs || 'not set'}`,
        `Admin Channel: ${config.channels.admin || 'not set'}`,
        `Ticket Channel/Category: ${config.channels.ticket || 'not set'}`,
        `Mens Label Emoji: ${config.teams?.mens?.emoji || 'not set'}`,
        `Womens Label Emoji: ${config.teams?.womens?.emoji || 'not set'}`,
        '',
        '_Note: Bot token changes are stored for restart/reference and do not hot-swap runtime auth._'
      ].join('\n');

      await interaction.reply({ content: message, ephemeral: true });
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
          ephemeral: true
        });
        return;
      }
      if (!validateField(field, value)) {
        await interaction.reply({ content: 'Invalid token reference format.', ephemeral: true });
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
          ephemeral: true
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
          ephemeral: true
        });
        return;
      }
    }

    const configPath = FIELD_MAP[field];
    updateConfig(configPath, value);

    await interaction.reply({
      content: `✅ Updated **${field}**. ${field === 'bot_token_reference' ? 'Restart bot to use new token.' : ''}`,
      ephemeral: true
    });
  }
};
