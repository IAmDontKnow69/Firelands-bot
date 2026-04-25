const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
  MessageFlags
} = require('discord.js');
const cron = require('node-cron');

const attendanceCommand = require('./commands/attendance');
const adminConfigCommand = require('./commands/admin-config');
const playerCommand = require('./commands/player');
const coachCommand = require('./commands/coach');
const adminCommand = require('./commands/admin');
const confirmCommand = require('./commands/confirm');
const interactionHandler = require('./events/interactionCreate');
const { fetchUpcomingEvents } = require('./utils/googleCalendar');
const { loadDb, upsertEvent, setEventMessageId } = require('./utils/database');
const { startReminderJobs } = require('./utils/reminders');
const { ensureConfig, loadConfig } = require('./utils/config');
const { syncAllToSheet, appendCommandLogRow } = require('./utils/googleSheetsSync');

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
client.commands.set(adminConfigCommand.data.name, adminConfigCommand);
client.commands.set(playerCommand.data.name, playerCommand);
client.commands.set(coachCommand.data.name, coachCommand);
client.commands.set(adminCommand.data.name, adminCommand);
client.commands.set(confirmCommand.data.name, confirmCommand);

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
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: [
        attendanceCommand.data.toJSON(),
        adminConfigCommand.data.toJSON(),
        playerCommand.data.toJSON(),
        coachCommand.data.toJSON(),
        adminCommand.data.toJSON(),
        confirmCommand.data.toJSON()
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

function isWithinDays(dateValue, days) {
  const eventTime = new Date(dateValue).getTime();
  if (Number.isNaN(eventTime)) return false;
  const diff = eventTime - Date.now();
  return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000;
}

async function postEventMessage(event) {
  const config = getConfig();
  const teamChatChannelId = config.channels.teamChats?.[event.team];
  const eventsChannelId = teamChatChannelId || config.channels.events;

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
    content: `<@&${teamRoleId}>\n📅 ${event.title}\n🕒 ${formatEventDate(event.date)}\nPlease mark your availability now.`,
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
          team: event.team,
          discordMessageId: '',
          responses: {}
        });
      } else {
        upsertEvent(event.id, {
          title: event.title,
          date: event.date,
          team: existingEvent.team || event.team
        });
      }

      const latestDb = loadDb();
      const syncedEvent = latestDb.events[event.id];

      if (!syncedEvent?.team || syncedEvent.discordMessageId) continue;
      if (!isWithinDays(syncedEvent.date, 14)) continue;

      await postEventMessage({ ...syncedEvent, id: event.id });
      console.log(`Posted new event: ${syncedEvent.title} (${event.id})`);
    }

    if (config.googleSync?.enabled) {
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
    if (interaction.isChatInputCommand()) {
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

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: `Something went wrong. Error logged to admin chat.\nReason: ${error.message}`, flags: MessageFlags.Ephemeral });
    }
  }
});

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await registerSlashCommands();
  await syncCalendarEvents();

  cron.schedule('*/5 * * * *', async () => {
    await syncCalendarEvents();
  });

  startReminderJobs(client, getConfig);
});

client.on('guildCreate', async (guild) => {
  const setupChannel = findGuildSetupChannel(guild);
  if (!setupChannel) return;

  const setupMessage = [
    '👋 Thanks for inviting Firelands Bot!',
    '',
    'To finish setup, please configure these two fields:',
    '1) **Admin chat channel** (used for bot logs/admin notices)',
    '2) **Admin role** (only this role can use `/admin` and `/admin-config` once set)',
    '',
    'Run:',
    '`/admin-config set field:admin_channel_id channel:<your admin channel>`',
    '`/admin-config set field:admin_role_id role:<your admin role>`'
  ].join('\n');

  await setupChannel.send(setupMessage).catch(() => null);
});

client.login(TOKEN);
