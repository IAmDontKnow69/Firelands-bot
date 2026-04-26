const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  REST,
  Routes,
  MessageFlags
} = require('discord.js');
const cron = require('node-cron');

const attendanceCommand = require('./commands/attendance');
const playerCommand = require('./commands/player');
const coachCommand = require('./commands/coach');
const adminCommand = require('./commands/admin');
const confirmCommand = require('./commands/confirm');
const interactionHandler = require('./events/interactionCreate');
const { fetchUpcomingEvents } = require('./utils/googleCalendar');
const { loadDb, saveDb, upsertEvent, setEventMessageId } = require('./utils/database');
const { startReminderJobs } = require('./utils/reminders');
const { ensureConfig, loadConfig, updateConfig, resetConfigFresh } = require('./utils/config');
const {
  syncAllToSheet,
  syncConfigOnlyToSheet,
  appendCommandLogRow,
  loadSheetBackups,
  restoreSpreadsheetFromBackupSnapshot
} = require('./utils/googleSheetsSync');
const { getTeamSetupProgress, getIncompleteTeamsForMember, buildIncompleteTeamMessage } = require('./utils/teamSetup');

ensureConfig();

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('Missing DISCORD_TOKEN environment variable for runtime login.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

client.commands = new Collection();
client.commands.set(attendanceCommand.data.name, attendanceCommand);
client.commands.set(playerCommand.data.name, playerCommand);
client.commands.set(coachCommand.data.name, coachCommand);
client.commands.set(adminCommand.data.name, adminCommand);
client.commands.set(confirmCommand.data.name, confirmCommand);
const missingAttendanceConfigWarnings = new Set();

function buildSetupSummary(config) {
  const adminRole = config.bot?.adminRoleId ? `<@&${config.bot.adminRoleId}>` : 'not set';
  const adminChannel = config.channels?.admin ? `<#${config.channels.admin}>` : 'not set';
  return [
    '⚙️ **Firelands Setup Wizard**',
    'Choose /admin access role and admin logs channel below.',
    'Player and coach command access is automatically derived from team player/coach roles.',
    '',
    `• /admin access role: ${adminRole}`,
    `• Admin logs channel: ${adminChannel}`,
    '',
    'Then choose initialization mode (this final step will complete and remove this wizard message):',
    '• **Fresh Config + Empty Sheets** = wipe data, rebuild all tabs with headings only.',
    '• **Load Backup Slot** = restore all non-Backups tabs from a saved slot.',
    '• **Sync Config Only** = keep data and only push config tabs.'
  ].join('\n');
}

function createSetupRows() {
  return [
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('setup_role_admin')
        .setPlaceholder('Select role for /admin access')
        .setMinValues(1)
        .setMaxValues(1)
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('setup_channel_admin')
        .setPlaceholder('Select admin logs channel')
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1)
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('setup_sheet_mode')
        .setPlaceholder('Choose setup action')
        .addOptions([
          { label: 'Fresh Config + Empty Sheets', value: 'fresh_config' },
          { label: 'Load Backup Slot', value: 'load_backup' },
          { label: 'Sync Config Only (preserve data)', value: 'config_only' }
        ])
    )
  ];
}

function getConfig() {
  return loadConfig();
}

function toOptionSummary(interaction) {
  try {
    const flat = (interaction.options?.data || []).map((option) => {
      const nested = (option.options || []).map((sub) => ({ name: sub.name, value: sub.value ?? null }));
      return { name: option.name, value: option.value ?? null, options: nested };
    });
    return JSON.stringify(flat);
  } catch {
    return '[]';
  }
}

function summarizeInteractionContext(interaction) {
  const parts = [];
  if (interaction.commandName) parts.push(`command=${interaction.commandName}`);
  if (interaction.customId) parts.push(`customId=${interaction.customId}`);
  if (interaction.user?.tag) parts.push(`user=${interaction.user.tag}`);
  if (interaction.guildId) parts.push(`guild=${interaction.guildId}`);
  if (interaction.channelId) parts.push(`channel=${interaction.channelId}`);
  return parts.join(' | ');
}

async function logCommandUsage(interaction) {
  try {
    const config = getConfig();
    if (!config.googleSync?.enabled) return;

    let subcommand = '';
    try {
      subcommand = interaction.options?.getSubcommand(false) || '';
    } catch {
      subcommand = '';
    }

    await appendCommandLogRow(config, {
      source: 'slash',
      command: interaction.commandName,
      subcommand,
      options: toOptionSummary(interaction),
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      username: interaction.user.tag
    });
  } catch (error) {
    await sendLog(`⚠️ Command log write failed: ${error.message}`);
  }
}

async function sendLog(message) {
  const config = getConfig();
  const logsChannelId = config.channels.admin || config.channels.logs;

  if (!logsChannelId) return;

  try {
    const logsChannel = await client.channels.fetch(logsChannelId);
    if (logsChannel && logsChannel.isTextBased()) {
      await logsChannel.send(message);
    }
  } catch (error) {
    console.error('Failed to write logs channel message:', error.message);
  }
}

async function registerSlashCommands() {
  const config = getConfig();
  const clientId = config.bot.clientId || process.env.DISCORD_CLIENT_ID;
  const guildId = config.bot.guildId || process.env.DISCORD_GUILD_ID;

  if (!clientId || !guildId) {
    console.error('Missing client or guild ID for slash command registration.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    const guildBody = [
      attendanceCommand.data.toJSON(),
      playerCommand.data.toJSON(),
      coachCommand.data.toJSON(),
      adminCommand.data.toJSON(),
      confirmCommand.data.toJSON()
    ];
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: guildBody
    });
    await rest.put(Routes.applicationCommands(clientId), {
      body: [
        playerCommand.data.toJSON(),
        coachCommand.data.toJSON(),
        adminCommand.data.toJSON()
      ]
    });
    console.log('Slash commands registered.');
  } catch (error) {
    console.error('Failed to register slash commands:', error);
  }
}

function formatEventDate(dateValue) {
  const date = new Date(dateValue);
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function findGuildSetupChannel(guild) {
  if (guild.systemChannel?.isTextBased()) return guild.systemChannel;

  const candidate = guild.channels.cache
    .filter((channel) => channel.isTextBased() && channel.viewable)
    .sort((a, b) => a.position - b.position)
    .first();

  return candidate || null;
}

async function postSetupWizardToGuild(guild) {
  const setupChannel = findGuildSetupChannel(guild);
  if (!setupChannel) return;
  await setupChannel.send({
    content: buildSetupSummary(getConfig()),
    components: createSetupRows()
  }).catch(() => null);
}

async function handleSetupInteraction(interaction) {
  if (!interaction.isStringSelectMenu() && !interaction.isRoleSelectMenu() && !interaction.isChannelSelectMenu()) return false;
  if (!String(interaction.customId || '').startsWith('setup_')) return false;

  if (interaction.customId === 'setup_sheet_mode') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    updateConfig('googleSync.enabled', true);
    const config = getConfig();
    try {
      if (interaction.values[0] === 'fresh_config') {
        resetConfigFresh();
        saveDb({ events: {}, futureAvailability: {}, absenceTickets: {}, players: {}, meta: { postEventCoachReminders: {} } });
        const freshConfig = getConfig();
        const result = await syncAllToSheet(freshConfig, loadDb(), { wipe: true });
        await interaction.editReply(result.ok
          ? `✅ Fresh config completed and sheet tabs rebuilt (\`${result.spreadsheetId}\`).`
          : 'Could not sync because spreadsheet ID is not configured.');
      } else if (interaction.values[0] === 'load_backup') {
        const backups = (await loadSheetBackups(config).catch(() => [])).sort((a, b) => a.slot - b.slot);
        if (!backups.length) {
          await interaction.editReply('No backup slots found in the Backups tab yet.');
          return true;
        }
        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('setup_restore_slot')
            .setPlaceholder('Choose backup slot to restore')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(backups.map((entry) => ({
              label: `Slot ${entry.slot} • ${entry.name || `Backup ${entry.slot}`}`.slice(0, 100),
              value: String(entry.slot),
              description: (entry.createdAt || 'unknown').slice(0, 100)
            })))
        );
        await interaction.editReply({ content: 'Pick a backup slot to restore.', components: [row] });
        return true;
      } else if (interaction.values[0] === 'fresh') {
        const result = await syncAllToSheet(config, loadDb(), { wipe: true });
        await interaction.editReply(result.ok
          ? `✅ Fresh sheet sync completed (\`${result.spreadsheetId}\`).`
          : 'Could not sync because spreadsheet ID is not configured.');
      } else {
        const result = await syncConfigOnlyToSheet(config);
        await interaction.editReply(result.ok
          ? `✅ Config-only sync completed (\`${result.spreadsheetId}\`). Existing sheet data was preserved.`
          : 'Could not sync because spreadsheet ID is not configured.');
      }
    } catch (error) {
      await interaction.editReply(`❌ Setup sheet action failed: ${error.message}`);
    }

    await interaction.message?.delete().catch(() => null);
    return true;
  }

  if (interaction.customId === 'setup_restore_slot' && interaction.isStringSelectMenu()) {
    await interaction.deferUpdate();
    const slot = Number.parseInt(interaction.values?.[0] || '0', 10);
    const config = getConfig();
    const backups = await loadSheetBackups(config).catch(() => []);
    const picked = backups.find((entry) => entry.slot === slot);
    if (!picked?.snapshot) {
      await interaction.message?.edit({ content: 'Selected slot is empty.', components: createSetupRows() }).catch(() => null);
      return true;
    }
    try {
      const parsed = JSON.parse(picked.snapshot);
      const progressState = { percent: 0, etaMs: 0, currentTab: '', tabs: [] };
      const toProgressText = (title) => [
        title,
        '',
        `Progress: **${progressState.percent}%**`,
        `ETA: **${Math.max(0, Math.round(progressState.etaMs / 1000))}s**`,
        `Current tab: ${progressState.currentTab || 'starting…'}`,
        '',
        ...(progressState.tabs.length ? progressState.tabs.map((tab) => `• ${tab}${tab === progressState.currentTab ? ' ⏳' : ''}`) : ['• no tabs'])
      ].join('\n');

      await interaction.message?.edit({ content: toProgressText(`♻️ Restoring backup slot ${slot}...`), components: [] }).catch(() => null);
      await restoreSpreadsheetFromBackupSnapshot(config, parsed, (progress) => {
        progressState.percent = progress.percent;
        progressState.etaMs = progress.etaMs;
        progressState.currentTab = progress.currentTab;
        progressState.tabs = progress.tabs || [];
      });
      await interaction.message?.edit({ content: toProgressText(`✅ Restored setup backup from slot ${slot}.`), components: [] }).catch(() => null);
    } catch (error) {
      await interaction.message?.edit({ content: `❌ Failed to restore slot ${slot}: ${error.message}`, components: createSetupRows() }).catch(() => null);
    }
    return true;
  }

  try {
    await interaction.deferUpdate();
  } catch (error) {
    if (error?.code === 10062) return true;
    throw error;
  }

  const config = getConfig();
  if (interaction.customId === 'setup_role_admin') {
    const roleId = interaction.values[0];
    if (config.bot?.adminRoleId !== roleId) updateConfig('bot.adminRoleId', roleId);
  }
  if (interaction.customId === 'setup_channel_admin') {
    const channelId = interaction.values[0];
    if (config.channels?.admin !== channelId) updateConfig('channels.admin', channelId);
  }

  await interaction.message?.edit({
    content: buildSetupSummary(getConfig()),
    components: createSetupRows()
  }).catch(() => null);
  return true;
}

function isWithinDays(dateValue, days) {
  const eventTime = new Date(dateValue).getTime();
  if (Number.isNaN(eventTime)) return false;
  const diff = eventTime - Date.now();
  return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000;
}

function getAttendanceChannelId(config, team) {
  return config.channels.teamChats?.[team] || config.channels.events || '';
}

function getAttendanceConfigIssue(config, team) {
  const progress = getTeamSetupProgress(config, team);
  if (progress.isComplete) return '';
  return `Team setup incomplete for ${team}. Missing: ${progress.missing.join(', ')}`;
}

async function warnMissingAttendanceConfig(team, issue) {
  const warningKey = `${team}:${issue}`;
  if (missingAttendanceConfigWarnings.has(warningKey)) return;
  missingAttendanceConfigWarnings.add(warningKey);
  await sendLog(`⚠️ Calendar sync skipped posting for **${team}**: ${issue}`);
}

function clearAttendanceWarning(team, issue) {
  const warningKey = `${team}:${issue}`;
  missingAttendanceConfigWarnings.delete(warningKey);
}

async function postEventMessage(event) {
  const config = getConfig();
  const eventsChannelId = getAttendanceChannelId(config, event.team);

  if (!eventsChannelId) {
    throw new Error('Events channel ID is not configured.');
  }

  const channel = await client.channels.fetch(eventsChannelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error('Events channel not found or not text based.');
  }

  const teamRoleId = config.roles[event.team]?.player;
  if (!teamRoleId || teamRoleId === 'ROLE_ID') {
    throw new Error(`Role ID not configured for team: ${event.team}`);
  }

  const attendingButton = new ButtonBuilder()
    .setCustomId(`attend_yes:${event.id}`)
    .setLabel('🟢 Attending')
    .setStyle(ButtonStyle.Success);

  const notAttendingButton = new ButtonBuilder()
    .setCustomId(`attend_no:${event.id}`)
    .setLabel('🔴 Not Attending')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(attendingButton, notAttendingButton);

  const message = await channel.send({
    content: [
      `<@&${teamRoleId}>`,
      `📅 ${event.title}`,
      `🕒 ${formatEventDate(event.date)}`,
      event.location ? `📍 ${event.location}` : null,
      'Please mark your availability now.'
    ].filter(Boolean).join('\n'),
    components: [row]
  });

  setEventMessageId(event.id, message.id);
  await sendLog(`📌 Posted event: **${event.title}** (${event.team})`);
}

async function syncCalendarEvents() {
  try {
    const config = getConfig();
    const teamMatchers = Object.fromEntries(
      Object.entries(config.teams || {}).map(([teamKey, meta]) => [
        teamKey,
        Array.isArray(meta?.eventNamePhrases) ? meta.eventNamePhrases : []
      ])
    );

    const calendarEvents = await fetchUpcomingEvents({
      calendarId: config.bot.calendarId || 'hello@firelandsunited.com',
      daysAhead: null,
      credentialsPath: config.bot.calendarCredentialsPath || '',
      teamMatchers
    });

    const db = loadDb();

    for (const event of calendarEvents) {
      const existingEvent = db.events[event.id];

      if (!existingEvent) {
        upsertEvent(event.id, {
          title: event.title,
          date: event.date,
          location: event.location || '',
          team: event.team,
          discordMessageId: '',
          responses: {}
        });
      } else {
        upsertEvent(event.id, {
          title: event.title,
          date: event.date,
          location: event.location || existingEvent.location || '',
          team: existingEvent.team || event.team
        });
      }

      const latestDb = loadDb();
      const syncedEvent = latestDb.events[event.id];

      if (!syncedEvent?.team || syncedEvent.discordMessageId) continue;
      if (!isWithinDays(syncedEvent.date, 14)) continue;

      const configIssue = getAttendanceConfigIssue(config, syncedEvent.team);
      if (configIssue) {
        await warnMissingAttendanceConfig(syncedEvent.team, configIssue);
        continue;
      }

      clearAttendanceWarning(syncedEvent.team, `Team setup incomplete for ${syncedEvent.team}. Missing: ${getTeamSetupProgress(config, syncedEvent.team).missing.join(', ')}`);

      await postEventMessage({ ...syncedEvent, id: event.id });
      console.log(`Posted new event: ${syncedEvent.title} (${event.id})`);
    }

    if (config.googleSync?.enabled && config.googleSync?.autoFullSync) {
      const latestDb = loadDb();
      await syncAllToSheet(config, latestDb);
    }
  } catch (error) {
    console.error('Calendar sync failed:', error);
    await sendLog(`❌ Calendar sync failed: ${error.message}`);
  }
}

client.on('interactionCreate', async (interaction) => {
  try {
    if (await handleSetupInteraction(interaction)) return;

    if (interaction.isChatInputCommand()) {
      if (interaction.inGuild() && ['player', 'coach'].includes(interaction.commandName)) {
        const botCommandsChannelId = getConfig().channels?.botCommands;
        if (botCommandsChannelId && interaction.channelId !== botCommandsChannelId) {
          await interaction.reply({
            content: `Please use \`/${interaction.commandName}\` in <#${botCommandsChannelId}>.`,
            flags: MessageFlags.Ephemeral
          });
          return;
        }
      }

      if (interaction.inGuild() && ['player', 'coach', 'attendance'].includes(interaction.commandName)) {
        let mode = interaction.commandName === 'coach' ? 'coach' : 'player';
        if (interaction.commandName === 'attendance') {
          mode = interaction.options.getSubcommand(false) === 'report' ? 'coach' : 'player';
        }
        const incompleteTeams = getIncompleteTeamsForMember(interaction.member, getConfig(), mode);
        if (incompleteTeams.length) {
          await interaction.reply({
            content: buildIncompleteTeamMessage(getConfig(), incompleteTeams),
            flags: MessageFlags.Ephemeral
          });
          return;
        }
      }

      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      await command.execute(interaction, { getConfig, sendLog });
      await logCommandUsage(interaction);
      return;
    }

    await interactionHandler.execute(interaction, { getConfig, sendLog });
  } catch (error) {
    console.error('Interaction handling failed:', error);
    await sendLog(`❌ Interaction failed: ${error.message}\n${summarizeInteractionContext(interaction)}`);

    const isUnknownInteraction = error?.code === 10062;
    if (!isUnknownInteraction && interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ content: `Something went wrong. Error logged to admin chat.\nReason: ${error.message}`, flags: MessageFlags.Ephemeral });
      } catch (replyError) {
        console.error('Failed to send interaction error reply:', replyError);
      }
    }
  }
});

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await registerSlashCommands();
  await syncCalendarEvents();
  for (const guild of client.guilds.cache.values()) {
    await postSetupWizardToGuild(guild);
  }

  cron.schedule('*/5 * * * *', async () => {
    await syncCalendarEvents();
  });

  startReminderJobs(client, getConfig);
});

client.on('guildCreate', async (guild) => {
  await postSetupWizardToGuild(guild);
});

client.login(TOKEN);
