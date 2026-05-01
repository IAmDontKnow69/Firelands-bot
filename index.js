const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  REST,
  Routes,
  MessageFlags,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const attendanceCommand = require('./commands/attendance');
const playerCommand = require('./commands/player');
const coachCommand = require('./commands/coach');
const adminCommand = require('./commands/admin');
const confirmCommand = require('./commands/confirm');
const interactionHandler = require('./events/interactionCreate');
const { fetchUpcomingEvents, fetchCalendarEvents, normalizeCalendarId } = require('./utils/googleCalendar');
const { loadDb, saveDb, upsertEvent, setEventMessageId, upsertPlayerProfile, getPlayerProfile } = require('./utils/database');
const { startReminderJobs } = require('./utils/reminders');
const { ensureConfig, loadConfig, saveConfig, updateConfig, resetConfigFresh } = require('./utils/config');
const {
  syncAllToSheet,
  syncConfigOnlyToSheet,
  appendCommandLogRow,
  loadSheetBackups,
  restoreSpreadsheetFromBackupSnapshot,
  loadConfigFromSheet,
  getSpreadsheetId,
  getSheetsClient
} = require('./utils/googleSheetsSync');
const { version: BOT_BUILD_VERSION = '0.0.0' } = require('./package.json');
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
const REQUIRED_SETUP_TABS = ['Fixtures', 'Player and Coach Management', 'Attendance', 'Absences', 'Player and Coach Notes', 'Config', 'Command Logs', 'Backups'];
const setupRestoreDrafts = new Map();
const SETUP_LOGO_PATH = path.join(__dirname, 'assets', 'firelands-logo-transparent.png');

function buildSetupWelcome() {
  return [
    '👋 **Welcome to Firelands Bot**',
    '',
    '⚙️ This setup will guide you through the essentials and get your club ready quickly.',
    '',
    '🏟️ **About Firelands United FC**',
    '• We are building players, community, and elite football habits every week.',
    '• Check out our **free content** on YouTube and visit our website for more updates.',
    '',
    '🧰 **Core features:**',
    '• 📒 Player attendance records you can trust each week.',
    '• 📅 Players can manage their own fixtures with simple controls.',
    '• 🌴 Vacation mode to mark planned time away and keep coaches informed.',
    '• 🧑‍🏫 Coach management tools for squad oversight and decisions.',
    '• ✨ A fancy admin panel for setup, syncing, and club operations.',
    '',
    'Made by **George Villiers** and published by **Grev**.',
    '',
    '🚀 Press **Get Started** to open the setup wizard.'
  ].join('\n');
}

function buildSetupWelcomeEmbed() {
  const embed = new EmbedBuilder()
    .setColor(0xf08413)
    .setTitle('🔥 Firelands United')
    .setDescription('Professional setup flow for calendar, teams, and Google Sheets sync.')
    .setImage('attachment://firelands-logo-transparent.png');
  return embed;
}

function buildSetupSummary(config) {
  const draft = getSetupDraft();
  const adminRole = draft.adminRoleId ? `<@&${draft.adminRoleId}>` : 'not set';
  const adminChannel = draft.adminChannelId ? `<#${draft.adminChannelId}>` : 'not set';
  const calendarId = draft.calendarId || 'not set';
  const spreadsheetId = draft.spreadsheetId || 'not set';
  const statusNotice = String(draft.statusNotice || '').trim();
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'firelands-bot-sync@firelands-bot-494321.iam.gserviceaccount.com';
  return [
    '⚙️ **Firelands Setup Wizard**',
    'Choose /admin access role and admin logs channel below, then configure Google Calendar + Google Sheet.',
    'Player and coach command access is automatically derived from team player/coach roles.',
    '',
    `• /admin access role: ${adminRole}`,
    `• Admin logs channel: ${adminChannel}`,
    `• Google Calendar ID: \`${calendarId}\``,
    `• Google Sheet ID: \`${spreadsheetId}\``,
    `• Share your Google Calendar (read-only) with: \`${serviceAccountEmail}\``,
    `• Share your Google Sheet as **Editor** with: \`${serviceAccountEmail}\``,
    ...(statusNotice ? ['', statusNotice] : []),
    '',
    'Click **Check Google connections** to verify read-only calendar access and sheet write access (no fixtures are saved during this check).',
    'After checks pass, choose initialization mode:',
    '• **Fresh Config + Empty Sheets** = wipe data, rebuild all tabs with headings only.',
    '• **Load Backup Slot** = restore every synced tab from one saved backup line in the Backups sheet (max 5 slots).'
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
      new ButtonBuilder()
        .setCustomId('setup_set_calendar_id')
        .setLabel('🗓️ Set Google Calendar ID')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('setup_set_sheet_url')
        .setLabel('📄 Set Google Sheet URL')
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('setup_validate_google')
        .setLabel('🔎 Check Google connections')
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function createSetupModeRows() {
  return createSetupModeRowsWithBackup(true);
}

function createSetupModeRowsWithBackup(includeBackup = true) {
  const options = [
    { label: 'Fresh Config + Empty Sheets', value: 'fresh_config' }
  ];
  if (includeBackup) options.push({ label: 'Load Backup Slot', value: 'load_backup' });

  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('setup_sheet_mode')
        .setPlaceholder('Choose initialization action')
        .addOptions(options)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('setup_back_to_mode')
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function createSetupWelcomeRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('setup_get_started')
        .setLabel('🚀 Get Started')
        .setStyle(ButtonStyle.Success)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('🔴 YouTube Channel')
        .setStyle(ButtonStyle.Link)
        .setURL('https://www.youtube.com/@FirelandsUnited'),
      new ButtonBuilder()
        .setLabel('🟧 Firelands Website')
        .setStyle(ButtonStyle.Link)
        .setURL('https://firelandsunited.com/home/')
    )
  ];
}

function createSetupFinishRow() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('setup_delete_message')
        .setLabel('Delete this message')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function createSetupBackupRows(backups = []) {
  const bySlot = new Map(backups.map((entry) => [entry.slot, entry]));
  const describeVersionRisk = (backupVersion = '') => {
    if (!backupVersion || backupVersion === BOT_BUILD_VERSION) {
      return { emoji: '🟢', label: `Build ${backupVersion || 'unknown'} (safe)` };
    }
    const [majorA = 0, minorA = 0] = String(BOT_BUILD_VERSION).split('.').map((v) => Number.parseInt(v, 10) || 0);
    const [majorB = 0, minorB = 0] = String(backupVersion).split('.').map((v) => Number.parseInt(v, 10) || 0);
    if (majorA !== majorB) return { emoji: '🔴', label: `Build ${backupVersion} (high risk)` };
    if (minorA !== minorB) return { emoji: '🟡', label: `Build ${backupVersion} (medium risk)` };
    return { emoji: '🟢', label: `Build ${backupVersion} (safe)` };
  };

  const slotOptions = Array.from({ length: 5 }, (_, idx) => {
    const slot = idx + 1;
    const entry = bySlot.get(slot);
    const risk = describeVersionRisk(entry?.buildVersion || '');
    return {
      label: `Slot ${slot} • ${entry?.name || (entry ? `Backup ${slot}` : 'Empty slot')}`.slice(0, 100),
      value: String(slot),
      description: entry ? `${risk.emoji} ${risk.label}`.slice(0, 100) : (entry?.createdAt || 'No backup saved').slice(0, 100)
    };
  });

  const backupPickerRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('setup_restore_slot')
      .setPlaceholder('Choose backup slot to restore')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(slotOptions)
  );

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('setup_back_to_mode')
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary)
  );

  return [backupPickerRow, backRow];
}

function createSetupYellowImportRows(candidateTabs = []) {
  const options = candidateTabs.slice(0, 25).map((tab) => ({
    label: tab.slice(0, 100),
    value: tab,
    description: `Import ${tab}`.slice(0, 100)
  }));
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('setup_restore_pick_tabs')
        .setPlaceholder('Select tabs to import from backup')
        .setMinValues(1)
        .setMaxValues(Math.max(1, Math.min(options.length, 25)))
        .addOptions(options)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup_restore_yellow_back').setLabel('Back').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup_restore_yellow_import').setLabel('Import Selected Tabs').setStyle(ButtonStyle.Success)
    )
  ];
}

async function updateSetupMessageFromModal(interaction, sourceMessageId) {
  if (!sourceMessageId) return false;
  const channel = interaction.channel;
  if (!channel?.isTextBased()) return false;
  const targetMessage = await channel.messages.fetch(sourceMessageId).catch(() => null);
  if (!targetMessage) return false;
  await targetMessage.edit({
    content: buildSetupSummary(getConfig()),
    components: createSetupRows()
  }).catch(() => null);
  return true;
}

function toA1SheetName(title = '') {
  const raw = String(title || '').trim();
  if (!raw) return 'Backups';
  if (/^[A-Za-z0-9_]+$/.test(raw)) return raw;
  return `'${raw.replace(/'/g, "''")}'`;
}

async function inspectSetupSheetState(config = {}) {
  const spreadsheetId = getSpreadsheetId(config);
  if (!spreadsheetId) {
    return {
      existingTabs: [],
      missingRequiredTabs: [...REQUIRED_SETUP_TABS],
      hasBackupsTab: false,
      hasBackupSnapshots: false
    };
  }

  const sheets = await getSheetsClient(config);
  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTabs = (metadata.data.sheets || [])
    .map((sheet) => String(sheet.properties?.title || '').trim())
    .filter(Boolean);
  const titleLookup = new Map(existingTabs.map((title) => [title.toLowerCase(), title]));
  const missingRequiredTabs = REQUIRED_SETUP_TABS.filter((required) => !titleLookup.has(required.toLowerCase()));
  const backupsTitle = titleLookup.get('backups') || '';

  let hasBackupSnapshots = false;
  if (backupsTitle) {
    const backupsRows = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${toA1SheetName(backupsTitle)}!A2:G`
    }).catch(() => ({ data: { values: [] } }));
    const rows = backupsRows.data.values || [];
    hasBackupSnapshots = rows.some((row = []) => {
      const slot = Number.parseInt(String(row[0] || ''), 10);
      const snapshot = String(row[6] || '').trim();
      return Number.isInteger(slot) && slot >= 1 && slot <= 5 && Boolean(snapshot);
    });
  }

  return {
    existingTabs,
    missingRequiredTabs,
    hasBackupsTab: Boolean(backupsTitle),
    hasBackupSnapshots
  };
}

function progressBar(percent = 0, width = 20) {
  const safePercent = Math.min(100, Math.max(0, Number.isFinite(percent) ? Math.round(percent) : 0));
  const segments = 10;
  const filled = Math.round((safePercent / 100) * segments);
  return `${'🟩'.repeat(filled)}${'⬜'.repeat(Math.max(0, segments - filled))} ${safePercent}%${safePercent >= 100 ? '\n✅' : ''}`;
}

function buildGoogleConnectionCheckProgress(percent = 0, step = '') {
  const safeStep = String(step || '').trim() || 'Working…';
  return [
    '🔎 Checking Google Calendar read access and Google Sheets write access…',
    '',
    `Progress: **${progressBar(percent)}**`,
    `Step: ${safeStep}`
  ].join('\n');
}

function buildSetupRestoreProgressText(slot, progressState, done = false) {
  const safePercent = done ? 100 : Math.min(100, Math.max(0, Math.round(progressState.percent || 0)));
  return [
    `${done ? '✅' : '♻️'} ${done ? 'Backup import completed' : `Importing backup slot ${slot}`}`,
    '',
    `Loading: **${progressBar(safePercent)}**`,
    `ETA: **${Math.max(0, Math.round((progressState.etaMs || 0) / 1000))}s**`,
    `Current tab: ${progressState.currentTab || (done ? 'Complete' : 'starting…')}`,
    '',
    ...(progressState.tabs?.length ? progressState.tabs.map((tab) => `• ${tab}${!done && tab === progressState.currentTab ? ' ⏳' : ''}`) : ['• no tabs']),
    '',
    done ? 'Firelands Bot setup is complete and ready to use. Delete this message to finish setup.' : 'Please wait while Firelands imports this backup into all synced Google Sheet tabs.'
  ].join('\n');
}

function buildSetupFreshProgressText(progressState = {}, done = false) {
  const safePercent = done ? 100 : Math.min(100, Math.max(0, Math.round(progressState.percent || 0)));
  const etaSeconds = Math.max(0, Math.round((progressState.etaMs || 0) / 1000));
  const step = progressState.step || (done ? 'Complete' : 'starting…');
  return [
    `${done ? '✅' : '🛠️'} ${done ? 'Fresh setup completed' : 'Building fresh config + empty sheets'}`,
    '',
    `Loading: **${progressBar(safePercent)}**`,
    `ETA: **${etaSeconds}s**`,
    `Current step: ${step}`,
    '',
    'Please wait while Firelands resets config, rebuilds tabs, and prepares your sheet.'
  ].join('\n');
}

function getConfig() {
  return loadConfig();
}

function parseCalendarId(input = '') {
  const raw = String(input || '').trim();
  if (!raw) return '';
  return normalizeCalendarId(raw);
}

function shouldSendAdminErrorReport(interaction) {
  if (!interaction) return false;
  if (interaction.isChatInputCommand?.()) {
    return ['admin', 'player', 'coach'].includes(interaction.commandName);
  }
  const customId = String(interaction.customId || '');
  return customId.startsWith('admin_') || customId.startsWith('player_') || customId.startsWith('coach_');
}

function buildAdminErrorReport(error, interaction) {
  const lines = [
    `timestamp: ${new Date().toISOString()}`,
    `error: ${String(error?.message || error || 'Unknown error')}`,
    `stack: ${String(error?.stack || 'n/a')}`,
    `interactionType: ${interaction?.type ?? 'unknown'}`,
    `commandName: ${interaction?.commandName || ''}`,
    `customId: ${interaction?.customId || ''}`,
    `guildId: ${interaction?.guildId || ''}`,
    `channelId: ${interaction?.channelId || ''}`,
    `userId: ${interaction?.user?.id || ''}`,
    '',
    'context:',
    summarizeInteractionContext(interaction)
  ];
  return lines.join('\n');
}

async function sendAdminErrorReport(error, interaction) {
  const config = getConfig();
  const adminChannelId = config.channels?.admin || config.channels?.logs || interaction?.channelId || '';
  if (!adminChannelId) return;
  const reportText = buildAdminErrorReport(error, interaction);
  const fileName = `ui-error-${Date.now()}.log`;
  const summary = `🧾 UI error report generated.\nError: \`${String(error?.message || error || 'Unknown error')}\``;
  try {
    const channel = await client.channels.fetch(adminChannelId);
    if (!channel || !channel.isTextBased()) return;
    await channel.send({
      content: `${summary}\nPlease post this log file into Codex for diagnosis.`,
      files: [{ attachment: Buffer.from(reportText, 'utf8'), name: fileName }]
    });
  } catch (sendError) {
    console.error('Failed to send admin error report:', sendError.message);
  }
}

function getSetupDraft(guildId = '') {
  const db = loadDb();
  if (!guildId) {
    const drafts = db.meta?.setupWizardDraft || {};
    return drafts._global || Object.values(drafts)[0] || {
      adminRoleId: '',
      adminChannelId: '',
      calendarId: '',
      spreadsheetId: '',
      statusNotice: ''
    };
  }
  const key = guildId || '_global';
  return db.meta?.setupWizardDraft?.[key] || {
    adminRoleId: '',
    adminChannelId: '',
    calendarId: '',
    spreadsheetId: '',
    statusNotice: ''
  };
}

function saveSetupDraft(update = {}, guildId = '') {
  const db = loadDb();
  const key = guildId || '_global';
  if (!db.meta) db.meta = {};
  if (!db.meta.setupWizardDraft) db.meta.setupWizardDraft = {};
  db.meta.setupWizardDraft[key] = {
    ...getSetupDraft(guildId),
    ...update
  };
  saveDb(db);
  return db.meta.setupWizardDraft[key];
}

function applySetupDraftToConfig(draft = {}) {
  if (draft.adminRoleId) updateConfig('bot.adminRoleId', draft.adminRoleId);
  if (draft.adminChannelId) updateConfig('channels.admin', draft.adminChannelId);
  if (draft.calendarId) updateConfig('bot.calendarId', draft.calendarId);
  if (draft.spreadsheetId) updateConfig('googleSync.spreadsheetId', draft.spreadsheetId);
}

async function syncSetupConfigToSheetIfEnabled() {
  const config = getConfig();
  if (!config.googleSync?.enabled) return;
  if (!getSpreadsheetId(config)) return;
  await syncConfigOnlyToSheet(config);
}

async function clearSetupSpreadsheetTabsExceptBackups(config = {}) {
  const spreadsheetId = getSpreadsheetId(config);
  if (!spreadsheetId) return;
  const sheets = await getSheetsClient(config);
  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = Array.isArray(metadata.data?.sheets) ? metadata.data.sheets : [];
  const deleteRequests = existingSheets
    .map((sheet) => ({
      title: String(sheet?.properties?.title || ''),
      sheetId: sheet?.properties?.sheetId
    }))
    .filter((sheet) => Number.isInteger(sheet.sheetId))
    .filter((sheet) => sheet.title !== 'Backups')
    .map((sheet) => ({ deleteSheet: { sheetId: sheet.sheetId } }));
  if (!deleteRequests.length) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: deleteRequests }
  });
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

function formatInteractionError(error) {
  const code = error?.code ? `code=${error.code}` : '';
  const status = error?.status ? `status=${error.status}` : '';
  const message = String(error?.message || 'Unknown error');
  return [message, code, status].filter(Boolean).join(' | ');
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

async function sendLog(message, fallbackChannelId = '') {
  const config = getConfig();
  const logsChannelId = config.channels.admin || config.channels.logs || fallbackChannelId;

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

function buildSetupErrorReport(error, interaction, stage = 'setup') {
  const now = new Date().toISOString();
  const config = getConfig();
  const draft = getSetupDraft(interaction?.guildId);
  return [
    `timestamp: ${now}`,
    `stage: ${stage}`,
    `message: ${String(error?.message || error || 'Unknown error')}`,
    `stack:`,
    String(error?.stack || '(no stack available)'),
    '',
    'interaction:',
    `  customId: ${interaction?.customId || ''}`,
    `  userId: ${interaction?.user?.id || ''}`,
    `  userTag: ${interaction?.user?.tag || ''}`,
    `  guildId: ${interaction?.guildId || ''}`,
    `  channelId: ${interaction?.channelId || ''}`,
    '',
    'google_setup:',
    `  calendarId: ${draft?.calendarId || config.bot?.calendarId || ''}`,
    `  spreadsheetId: ${draft?.spreadsheetId || config.googleSync?.spreadsheetId || ''}`,
    '',
    'hint:',
    'Share this file and the visible error message in Codex for debugging.'
  ].join('\n');
}

async function sendSetupErrorReport(interaction, error, stage = 'setup') {
  const reportText = buildSetupErrorReport(error, interaction, stage);
  const fileName = `setup-error-${Date.now()}.log`;
  const summary = `🧾 Setup error report generated for **${stage}**.\nError: \`${String(error?.message || error || 'Unknown error')}\``;
  const payload = {
    content: `${summary}\nPlease upload this log file to Codex for troubleshooting.`,
    files: [{ attachment: Buffer.from(reportText, 'utf8'), name: fileName }]
  };

  const interactionChannelId = interaction?.channelId || '';
  if (interaction?.channel?.isTextBased?.()) {
    await interaction.channel.send(payload).catch(() => null);
  }

  const config = getConfig();
  const logsChannelId = config.channels.admin || config.channels.logs || interaction?.channelId || '';
  if (!logsChannelId) return;
  try {
    const logsChannel = await client.channels.fetch(logsChannelId);
    if (logsChannel && logsChannel.isTextBased() && logsChannel.id !== interactionChannelId) {
      await logsChannel.send(payload);
    }
  } catch (sendError) {
    console.error('Failed to send setup error report:', sendError.message);
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
        coachCommand.data.toJSON()
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

function getEventAnnouncementContent(event = {}, teamRoleId = '') {
  return [
    teamRoleId ? `<@&${teamRoleId}>` : null,
    `📅 ${event.title}`,
    `🕒 ${formatEventDate(event.date)}`,
    event.location ? `📍 ${event.location}` : null,
    'Please mark your availability now.'
  ].filter(Boolean).join('\n');
}

function summarizeEventChanges(previous = {}, incoming = {}) {
  const changes = [];
  if ((previous.title || '') !== (incoming.title || '')) {
    changes.push(`title: "${previous.title || 'n/a'}" → "${incoming.title || 'n/a'}"`);
  }
  if ((previous.date || '') !== (incoming.date || '')) {
    changes.push(`time: "${formatEventDate(previous.date)}" → "${formatEventDate(incoming.date)}"`);
  }
  if ((previous.location || '') !== (incoming.location || '')) {
    changes.push(`location: "${previous.location || 'n/a'}" → "${incoming.location || 'n/a'}"`);
  }
  if ((previous.team || '') !== (incoming.team || '')) {
    changes.push(`team: "${previous.team || 'n/a'}" → "${incoming.team || 'n/a'}"`);
  }
  return changes;
}

function findGuildSetupChannel(guild) {
  if (guild.systemChannel?.isTextBased()) return guild.systemChannel;

  const candidate = guild.channels.cache
    .filter((channel) => channel.isTextBased() && channel.viewable)
    .sort((a, b) => a.position - b.position)
    .first();

  return candidate || null;
}

function hasCompletedSetupWizard(guildId) {
  const db = loadDb();
  return Boolean(db.meta?.setupWizard?.[guildId]?.completedAt);
}

function markSetupWizardCompleted(guildId) {
  const db = loadDb();
  if (!db.meta) db.meta = {};
  if (!db.meta.setupWizard) db.meta.setupWizard = {};
  db.meta.setupWizard[guildId] = {
    ...(db.meta.setupWizard[guildId] || {}),
    completedAt: new Date().toISOString()
  };
  saveDb(db);
}

async function postSetupWizardToGuild(guild) {
  if (hasCompletedSetupWizard(guild.id)) return;
  const setupChannel = findGuildSetupChannel(guild);
  if (!setupChannel) return;
  const hasLogo = fs.existsSync(SETUP_LOGO_PATH);
  await setupChannel.send({
    content: buildSetupWelcome(),
    components: createSetupWelcomeRows(),
    ...(hasLogo
      ? {
          embeds: [buildSetupWelcomeEmbed()],
          files: [{ attachment: SETUP_LOGO_PATH, name: 'firelands-logo-transparent.png' }]
        }
      : {})
  }).catch(() => null);
}

async function finalizeSetupWizard(interaction) {
  if (interaction.guildId) markSetupWizardCompleted(interaction.guildId);
  const setupChannel = interaction.channel;
  if (!setupChannel?.isTextBased()) return;

  const recentMessages = await setupChannel.messages.fetch({ limit: 50 }).catch(() => null);
  if (recentMessages) {
    const setupMessages = recentMessages.filter((message) => {
      if (message.author?.id !== interaction.client.user?.id) return false;
      const text = `${message.content || ''} ${(message.components || []).map((row) => row.components.map((component) => component.customId || '').join(' ')).join(' ')}`;
      return text.includes('setup_')
        || text.includes('Firelands Setup Wizard')
        || text.includes('Welcome to Firelands Bot')
        || text.includes('Start using Firelands Bot');
    });
    await Promise.all(setupMessages.map((message) => message.delete().catch(() => null)));
  }
}

async function handleSetupInteraction(interaction) {
  if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isRoleSelectMenu() && !interaction.isChannelSelectMenu() && !interaction.isModalSubmit()) return false;
  if (!String(interaction.customId || '').startsWith('setup_')) return false;

  if (interaction.customId === 'setup_get_started' && interaction.isButton()) {
    if (!getSetupDraft(interaction.guildId).calendarId && !getSetupDraft(interaction.guildId).spreadsheetId) {
      saveSetupDraft({}, interaction.guildId);
    }
    await interaction.update({
      content: buildSetupSummary(getConfig()),
      components: createSetupRows()
    }).catch(() => null);
    return true;
  }
  if (interaction.customId === 'setup_delete_message' && interaction.isButton()) {
    const member = interaction.member;
    const canDelete = Boolean(member?.permissions?.has?.(PermissionFlagsBits.ManageMessages) || member?.permissions?.has?.(PermissionFlagsBits.Administrator));
    if (!canDelete) {
      await interaction.reply({ content: 'Only admins can delete this setup message.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    await interaction.message?.delete().catch(() => null);
    await interaction.reply({ content: '✅ Setup message deleted.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }
  if (interaction.customId === 'setup_back_to_mode' && interaction.isButton()) {
    await interaction.update({
      content: buildSetupSummary(getConfig()),
      components: createSetupRows()
    }).catch(() => null);
    return true;
  }
  if (interaction.customId === 'setup_restore_yellow_back' && interaction.isButton()) {
    const backups = (await loadSheetBackups(getConfig()).catch(() => [])).sort((a, b) => a.slot - b.slot);
    setupRestoreDrafts.delete(interaction.guildId || interaction.user?.id || 'default');
    await interaction.update({
      content: 'Pick a backup slot to restore. You can press **Back** to choose Fresh Config instead.',
      components: createSetupBackupRows(backups)
    }).catch(() => null);
    return true;
  }
  if (interaction.customId === 'setup_set_calendar_id' && interaction.isButton()) {
    const draft = getSetupDraft(interaction.guildId);
    const modal = new ModalBuilder().setCustomId(`setup_set_calendar_id_modal:${interaction.message?.id || ''}`).setTitle('Set Google Calendar ID');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('calendar_id')
          .setLabel('Google Calendar ID or URL')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(draft.calendarId || '')
      )
    );
    await interaction.showModal(modal).catch(() => null);
    return true;
  }
  if (interaction.customId === 'setup_set_sheet_url' && interaction.isButton()) {
    const draft = getSetupDraft(interaction.guildId);
    const modal = new ModalBuilder().setCustomId(`setup_set_sheet_url_modal:${interaction.message?.id || ''}`).setTitle('Set Google Sheet URL');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('sheet_input')
          .setLabel('Google Sheet URL or Spreadsheet ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(draft.spreadsheetId || '')
      )
    );
    await interaction.showModal(modal).catch(() => null);
    return true;
  }
  if (interaction.customId === 'setup_validate_google' && interaction.isButton()) {
    await interaction.update({
      content: buildGoogleConnectionCheckProgress(0, 'Starting checks'),
      components: []
    }).catch(() => null);

    const config = getConfig();
    const draft = getSetupDraft(interaction.guildId);
    const calendarId = draft.calendarId || '';
    const spreadsheetId = getSpreadsheetId({ googleSync: { spreadsheetId: draft.spreadsheetId || '' } }) || '';
    if (!calendarId || !spreadsheetId) {
      await interaction.message?.edit({
        content: `❌ Missing Google details.\nCalendar ID: \`${calendarId || 'not set'}\`\nSheet ID: \`${spreadsheetId || 'not set'}\`\n\nPlease recheck your Calendar ID and Sheet URL/ID, then click **Check Google connections** again.`,
        components: createSetupRows()
      }).catch(() => null);
      return true;
    }

    try {
      const updateCheckProgress = async (percent, step) => {
        await interaction.message?.edit({
          content: buildGoogleConnectionCheckProgress(percent, step),
          components: []
        }).catch(() => null);
      };

      await updateCheckProgress(20, 'Reading Google Calendar');
      await fetchCalendarEvents({
        calendarId,
        daysAhead: 7,
        credentialsPath: config.bot?.calendarCredentialsPath || '',
        teamMatchers: {}
      });

      const sheets = await getSheetsClient(config);
      const testSheetTitle = `Firelands Test ${Date.now()}`;
      let testSheetId = null;

      await updateCheckProgress(40, `Creating temporary tab "${testSheetTitle}"`);
      const addSheetResponse = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: testSheetTitle }
              }
            }
          ]
        }
      });
      testSheetId = addSheetResponse.data.replies?.[0]?.addSheet?.properties?.sheetId ?? null;

      try {
        await updateCheckProgress(60, `Writing test row to "${testSheetTitle}"`);
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${toA1SheetName(testSheetTitle)}!A1:B`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [[new Date().toISOString(), 'connection_check_ok']] }
        });
      } finally {
        if (Number.isInteger(testSheetId)) {
          await updateCheckProgress(80, `Deleting temporary tab "${testSheetTitle}"`);
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [
                {
                  deleteSheet: {
                    sheetId: testSheetId
                  }
                }
              ]
            }
          }).catch(() => null);
        }
      }

      await updateCheckProgress(90, 'Checking Backups availability');
      const sheetState = await inspectSetupSheetState(config).catch(() => null);
      const backupsTabAvailable = Boolean(sheetState?.hasBackupsTab);
      const hasBackupSnapshots = Boolean(sheetState?.hasBackupSnapshots);
      const missingTabs = Array.isArray(sheetState?.missingRequiredTabs) ? sheetState.missingRequiredTabs : [];

      await updateCheckProgress(100, 'Checks complete');
      await interaction.message?.edit({
        content: hasBackupSnapshots
          ? '✅ Calendar read + Sheet write checks passed.\n✅ Found backup snapshot(s) in **Backups**.\nChoose whether to restore a backup or start fresh.'
          : [
            '✅ Calendar read + Sheet write checks passed.',
            missingTabs.length
              ? `ℹ️ Missing setup tabs: ${missingTabs.join(', ')}.`
              : 'ℹ️ Required setup tabs were found.',
            backupsTabAvailable
              ? 'ℹ️ **Backups** tab exists but no restoreable snapshot was found.'
              : 'ℹ️ **Backups** tab was not found.',
            'You can continue with **Fresh Config + Empty Sheets**, which creates/rebuilds all required setup tabs.'
          ].join('\n'),
        components: createSetupModeRowsWithBackup(hasBackupSnapshots)
      }).catch(() => null);
    } catch (error) {
      await sendSetupErrorReport(interaction, error, 'setup_validate_google');
      await interaction.message?.edit({
        content: `❌ Google connection check failed: ${error.message}\n\nPlease recheck your Calendar ID and Sheet URL/ID, and make sure the sheet is shared as Editor with the service account email shown above.`,
        components: createSetupRows()
      }).catch(() => null);
    }
    return true;
  }
  if (interaction.customId.startsWith('setup_set_calendar_id_modal') && interaction.isModalSubmit()) {
    await interaction.deferUpdate().catch(() => null);
    const calendarInput = interaction.fields.getTextInputValue('calendar_id').trim();
    const calendarId = parseCalendarId(calendarInput);
    if (calendarId) {
      updateConfig('bot.calendarId', calendarId);
    }
    saveSetupDraft({
      calendarId,
      statusNotice: '✅ Google Calendar ID saved. Setup wizard updated in-place.'
    }, interaction.guildId);
    await syncSetupConfigToSheetIfEnabled().catch(() => null);
    const sourceMessageId = interaction.customId.split(':')[1] || '';
    const updated = await updateSetupMessageFromModal(interaction, sourceMessageId);
    if (updated) {
      await interaction.deleteReply().catch(() => null);
      return true;
    }
    await interaction.followUp({
      content: buildSetupSummary(getConfig()),
      components: createSetupRows(),
      flags: MessageFlags.Ephemeral
    }).catch(() => null);
    return true;
  }
  if (interaction.customId.startsWith('setup_set_sheet_url_modal') && interaction.isModalSubmit()) {
    await interaction.deferUpdate().catch(() => null);
    const input = interaction.fields.getTextInputValue('sheet_input').trim();
    const spreadsheetId = getSpreadsheetId({ googleSync: { spreadsheetId: input } }) || input;
    if (spreadsheetId) {
      updateConfig('googleSync.spreadsheetId', spreadsheetId);
    }
    saveSetupDraft({
      spreadsheetId,
      statusNotice: '✅ Google Sheet URL/ID saved. Setup wizard updated in-place.'
    }, interaction.guildId);
    await syncSetupConfigToSheetIfEnabled().catch(() => null);
    const sourceMessageId = interaction.customId.split(':')[1] || '';
    const updated = await updateSetupMessageFromModal(interaction, sourceMessageId);
    if (updated) {
      await interaction.deleteReply().catch(() => null);
      return true;
    }
    await interaction.followUp({
      content: buildSetupSummary(getConfig()),
      components: createSetupRows(),
      flags: MessageFlags.Ephemeral
    }).catch(() => null);
    return true;
  }

  if (interaction.customId === 'setup_sheet_mode') {
    await interaction.deferUpdate().catch(() => null);
    updateConfig('googleSync.enabled', true);
    const setupDraft = getSetupDraft(interaction.guildId);
    applySetupDraftToConfig(setupDraft);
    const config = getConfig();
    try {
      if (interaction.values[0] === 'fresh_config') {
        const startedAt = Date.now();
        const progressState = { percent: 0, etaMs: 0, step: 'Starting fresh setup' };
        const refreshFreshProgress = async (percent, step) => {
          const elapsed = Date.now() - startedAt;
          const safePercent = Math.max(1, Math.min(99, Math.round(percent)));
          const totalEstimate = elapsed * (100 / safePercent);
          const etaMs = Math.max(0, Math.round(totalEstimate - elapsed));
          progressState.percent = percent;
          progressState.etaMs = etaMs;
          progressState.step = step;
          await interaction.message?.edit({ content: buildSetupFreshProgressText(progressState), components: [] }).catch(() => null);
        };

        await refreshFreshProgress(5, 'Resetting local config');
        resetConfigFresh();
        await refreshFreshProgress(20, 'Clearing local database');
        saveDb({ events: {}, futureAvailability: {}, absenceTickets: {}, players: {}, meta: { postEventCoachReminders: {}, setupWizard: {} } });
        await refreshFreshProgress(35, 'Applying setup wizard draft values');
        applySetupDraftToConfig(setupDraft);
        const freshConfig = getConfig();
        await refreshFreshProgress(55, 'Clearing existing sheet tabs (keeping Backups)');
        await clearSetupSpreadsheetTabsExceptBackups(freshConfig);
        await refreshFreshProgress(75, 'Rebuilding required Google Sheet tabs');
        const result = await syncAllToSheet(freshConfig, loadDb(), { wipe: true, setupFreshWipe: true });
        await refreshFreshProgress(90, 'Loading latest config snapshot from sheet');
        const sheetConfig = await loadConfigFromSheet(getConfig()).catch(() => null);
        if (sheetConfig) saveConfig(sheetConfig);
        progressState.percent = 100;
        progressState.etaMs = 0;
        progressState.step = 'Complete';
        await interaction.message?.edit(result.ok
          ? { content: `${buildSetupFreshProgressText(progressState, true)}\n\n✅ Fresh config completed and sheet tabs rebuilt (\`${result.spreadsheetId}\`).\n\nWould you like to sync fixtures from Google Calendar now for the first time?`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_fresh_sync_yes').setLabel('Yes, sync fixtures now').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('setup_fresh_sync_no').setLabel('No, finish setup').setStyle(ButtonStyle.Secondary))] }
          : { content: 'Could not sync because spreadsheet ID is not configured.', components: createSetupRows() }).catch(() => null);
        return true;
      } else if (interaction.values[0] === 'load_backup') {
        const sheetState = await inspectSetupSheetState(config).catch(() => null);
        const hasBackupSnapshots = Boolean(sheetState?.hasBackupSnapshots);
        if (!hasBackupSnapshots) {
          await interaction.message?.edit({
            content: '⚠️ Could not load a backup because no restoreable snapshot was found in the **Backups** tab.\nPlease use **Fresh Config + Empty Sheets**.',
            components: createSetupModeRowsWithBackup(false)
          }).catch(() => null);
          return true;
        }
        const backups = (await loadSheetBackups(config).catch(() => [])).sort((a, b) => a.slot - b.slot);
        await interaction.message?.edit({
          content: 'Pick a backup slot to restore. You can press **Back** to choose Fresh Config instead.',
          components: createSetupBackupRows(backups)
        }).catch(() => null);
        return true;
      } else {
        await interaction.message?.edit({ content: 'Unknown setup action selected.', components: createSetupRows() }).catch(() => null);
      }
    } catch (error) {
      await sendSetupErrorReport(interaction, error, 'setup_sheet_mode');
      await interaction.message?.edit({ content: `❌ Setup sheet action failed: ${error.message}`, components: createSetupRows() }).catch(() => null);
    }

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
      let lastProgressEdit = 0;
      await interaction.message?.edit({ content: buildSetupRestoreProgressText(slot, progressState), components: [] }).catch(() => null);
      const backupBuild = picked.buildVersion || parsed?.buildVersion || '';
      const sameBuild = backupBuild && backupBuild === BOT_BUILD_VERSION;
      const [majorA = 0, minorA = 0] = String(BOT_BUILD_VERSION).split('.').map((v) => Number.parseInt(v, 10) || 0);
      const [majorB = 0, minorB = 0] = String(backupBuild).split('.').map((v) => Number.parseInt(v, 10) || 0);
      const riskEmoji = !backupBuild || sameBuild ? '🟢' : (majorA !== majorB ? '🔴' : (minorA !== minorB ? '🟡' : '🟢'));
      const configOnly = Boolean(backupBuild && !sameBuild);
      const yellowRisk = !sameBuild && majorA === majorB;
      if (yellowRisk) {
        const snapshotTabs = Array.isArray(parsed?.tabs) ? parsed.tabs.map((tab) => String(tab?.title || '')).filter(Boolean) : [];
        const sheets = await getSheetsClient(config);
        const metadata = await sheets.spreadsheets.get({ spreadsheetId: getSpreadsheetId(config) });
        const existingTabs = new Set((metadata.data.sheets || []).map((entry) => String(entry.properties?.title || '')).filter(Boolean));
        const candidateTabs = snapshotTabs.filter((title) => existingTabs.has(title));
        setupRestoreDrafts.set(interaction.guildId || interaction.user?.id || 'default', { parsed, slot, backupBuild, riskEmoji, candidateTabs, selectedTabs: candidateTabs });
        await interaction.message?.edit({
          content: `🟡 Backup build: \`${backupBuild || 'unknown'}\` • Current build: \`${BOT_BUILD_VERSION}\`\nSelect the tabs you want to import. Only matching existing tabs can be replaced.`,
          components: candidateTabs.length ? createSetupYellowImportRows(candidateTabs) : [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_restore_yellow_back').setLabel('Back').setStyle(ButtonStyle.Secondary))]
        }).catch(() => null);
        return true;
      }
      await interaction.message?.edit({
        content: `${riskEmoji} Backup build: \`${backupBuild || 'unknown'}\` • Current build: \`${BOT_BUILD_VERSION}\`${configOnly ? '\n⚠️ Build mismatch detected: restoring Config tab only to reduce database break risk.' : '\n✅ Build match detected: restoring all tabs.'}`,
        components: []
      }).catch(() => null);
      await restoreSpreadsheetFromBackupSnapshot(config, parsed, (progress) => {
        progressState.percent = progress.percent;
        progressState.etaMs = progress.etaMs;
        progressState.currentTab = progress.currentTab;
        progressState.tabs = progress.tabs || [];
        const now = Date.now();
        if (now - lastProgressEdit >= 1500) {
          lastProgressEdit = now;
          interaction.message?.edit({
            content: `${riskEmoji} Backup build: \`${backupBuild || 'unknown'}\` • Current build: \`${BOT_BUILD_VERSION}\`\n${buildSetupRestoreProgressText(slot, progressState)}${configOnly ? '\n⚠️ Config-only restore mode is active.' : ''}`,
            components: []
          }).catch(() => null);
        }
      }, { configOnly });
      const restoredConfig = await loadConfigFromSheet(config).catch(() => null);
      if (restoredConfig) saveConfig(restoredConfig);
      progressState.percent = 100;
      await interaction.message?.edit({
        content: buildSetupRestoreProgressText(slot, progressState, true),
        components: createSetupFinishRow()
      }).catch(() => null);
    } catch (error) {
      await sendSetupErrorReport(interaction, error, 'setup_restore_slot');
      await interaction.message?.edit({ content: `❌ Failed to restore slot ${slot}: ${error.message}`, components: createSetupRows() }).catch(() => null);
    }
    return true;
  }
  if (interaction.customId === 'setup_restore_pick_tabs' && interaction.isStringSelectMenu()) {
    await interaction.deferUpdate();
    const key = interaction.guildId || interaction.user?.id || 'default';
    const draft = setupRestoreDrafts.get(key);
    if (!draft) return true;
    draft.selectedTabs = interaction.values || [];
    setupRestoreDrafts.set(key, draft);
    return true;
  }
  if (interaction.customId === 'setup_restore_yellow_import' && interaction.isButton()) {
    await interaction.deferUpdate();
    const key = interaction.guildId || interaction.user?.id || 'default';
    const draft = setupRestoreDrafts.get(key);
    if (!draft?.parsed) {
      await interaction.message?.edit({ content: 'No yellow-risk restore draft found. Please pick a backup slot again.', components: createSetupRows() }).catch(() => null);
      return true;
    }
    const selectedTabs = Array.isArray(draft.selectedTabs) && draft.selectedTabs.length ? draft.selectedTabs : draft.candidateTabs;
    const progressState = { percent: 0, etaMs: 0, currentTab: '', tabs: [] };
    await interaction.message?.edit({ content: `🟡 Starting selected-tab import from slot ${draft.slot}...`, components: [] }).catch(() => null);
    await restoreSpreadsheetFromBackupSnapshot(getConfig(), draft.parsed, (progress) => {
      progressState.percent = progress.percent;
      progressState.currentTab = progress.currentTab;
      interaction.message?.edit({ content: `🟡 Importing selected tabs...\n${buildSetupRestoreProgressText(draft.slot, progressState)}\nTabs: ${selectedTabs.join(', ')}`, components: [] }).catch(() => null);
    }, { allowedTabs: selectedTabs });
    setupRestoreDrafts.delete(key);
    await interaction.message?.edit({ content: '✅ Selected tab import completed.', components: createSetupFinishRow() }).catch(() => null);
    return true;
  }
  if ((interaction.customId === 'setup_fresh_sync_yes' || interaction.customId === 'setup_fresh_sync_no') && interaction.isButton()) {
    if (interaction.customId === 'setup_fresh_sync_no') {
      await interaction.update({
        content: '✅ Setup complete with fresh data.\nFirelands Bot is ready to use. Delete this message to finish setup.',
        components: createSetupFinishRow()
      }).catch(() => null);
      return true;
    }
    await interaction.update({ content: `${progressBar(15)} Syncing fixtures from Google Calendar...`, components: [] }).catch(() => null);
    try {
      const syncResult = await syncCalendarEvents({ throwOnError: true });
      const sheetConfig = await loadConfigFromSheet(getConfig()).catch(() => null);
      if (sheetConfig) saveConfig(sheetConfig);
      await interaction.message?.edit({
        content: `${progressBar(100)} ✅ Fixture sync completed (${syncResult.totalEvents} calendar event(s) checked).\nFirelands Bot setup is complete and ready to use. Delete this message to finish setup.`,
        components: createSetupFinishRow()
      }).catch(() => null);
    } catch (error) {
      await sendSetupErrorReport(interaction, error, 'setup_fresh_sync');
      await interaction.message?.edit({ content: `❌ Fixture sync failed: ${error.message}`, components: createSetupFinishRow() }).catch(() => null);
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
    if (roleId) updateConfig('bot.adminRoleId', roleId);
    saveSetupDraft({ adminRoleId: roleId }, interaction.guildId);
    await syncSetupConfigToSheetIfEnabled().catch(() => null);
  }
  if (interaction.customId === 'setup_channel_admin') {
    const channelId = interaction.values[0];
    saveSetupDraft({ adminChannelId: channelId }, interaction.guildId);
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
  const teamDeliveryMode = config.channels?.teamDeliveryMode?.[team] || 'team_chat';
  if (teamDeliveryMode === 'bot_commands' && config.channels?.botCommands) return config.channels.botCommands;
  return config.channels.teamChats?.[team] || config.channels.events || '';
}

function getAttendanceConfigIssue(config, team) {
  const progress = getTeamSetupProgress(config, team);
  if (progress.isComplete) return '';
  const teamName = config.teams?.[team]?.label || team;
  return `Team setup incomplete for ${teamName}. Missing: ${progress.missing.join(', ')}`;
}

async function warnMissingAttendanceConfig(team, issue) {
  const config = getConfig();
  const teamName = config.teams?.[team]?.label || team;
  const warningKey = `${team}:${issue}`;
  if (missingAttendanceConfigWarnings.has(warningKey)) return;
  missingAttendanceConfigWarnings.add(warningKey);
  await sendLog(`⚠️ Calendar sync skipped posting for **${teamName}**: ${issue}`);
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

  const teamRole = channel.guild.roles.cache.get(teamRoleId);
  const members = Array.from(teamRole?.members?.values() || []);
  const db = loadDb();
  const dmUsers = [];
  const teamChatUsers = [];
  for (const member of members) {
    const mode = db.players?.[member.id]?.attendanceDeliveryMode === 'team_chat' ? 'team_chat' : 'dm';
    if (mode === 'dm') dmUsers.push(member);
    else teamChatUsers.push(member);
  }

  for (const member of dmUsers) {
    await member.send({
      content: ['Only you can see this.', getEventAnnouncementContent(event, '')].join('\n'),
      components: [row]
    }).catch(() => null);
  }

  const mentionLine = teamChatUsers.length ? teamChatUsers.map((member) => `<@${member.id}>`).join(' ') : `<@&${teamRoleId}>`;
  const message = await channel.send({
    content: [mentionLine, getEventAnnouncementContent(event, '')].join('\n'),
    components: [row]
  });

  setEventMessageId(event.id, message.id);
  await sendLog(`📌 Posted event: **${event.title}** (${event.team}) • DM: ${dmUsers.length}, Team chat: ${teamChatUsers.length}`);
}

async function updatePostedEventMessage(eventId, event) {
  if (!event?.discordMessageId || !event?.team) return false;
  const config = getConfig();
  const teamChatId = config.channels?.teamChats?.[event.team];
  const teamRoleId = config.roles?.[event.team]?.player || '';
  if (!teamChatId) return false;
  const channel = await client.channels.fetch(teamChatId).catch(() => null);
  if (!channel?.isTextBased()) return false;
  const message = await channel.messages.fetch(event.discordMessageId).catch(() => null);
  if (!message) return false;
  await message.edit({
    content: getEventAnnouncementContent(event, teamRoleId),
    components: message.components || []
  }).catch(() => null);
  return true;
}

async function notifyAttendingUsersAboutChange(event = {}, changeLines = []) {
  if (!event?.id || !changeLines.length) return;
  const latestDb = loadDb();
  const responses = latestDb.events?.[event.id]?.responses || {};
  const attendingIds = Object.entries(responses)
    .filter(([, response]) => response?.status === 'yes')
    .map(([userId]) => userId);
  for (const userId of attendingIds) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) continue;
    await user.send([
      `🔔 **Fixture update:** ${event.title}`,
      `• ${changeLines.join('\n• ')}`,
      `Updated time: ${formatEventDate(event.date)}`,
      event.location ? `Updated location: ${event.location}` : ''
    ].filter(Boolean).join('\n')).catch(() => null);
  }
}

async function syncCalendarEvents(options = {}) {
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
    let postedCount = 0;

    for (const event of calendarEvents) {
      const existingEvent = db.events[event.id];
      const normalizedIncoming = {
        title: event.title,
        date: event.date,
        location: event.location || '',
        team: existingEvent?.team || event.team
      };
      const changeLines = existingEvent ? summarizeEventChanges(existingEvent, normalizedIncoming) : [];

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
      const syncedWithId = { ...syncedEvent, id: event.id };

      if (changeLines.length) {
        await updatePostedEventMessage(event.id, syncedWithId);
        await notifyAttendingUsersAboutChange(syncedWithId, changeLines);
        await sendLog([
          `📝 Calendar event updated: **${syncedEvent.title}** (${event.id})`,
          ...changeLines.map((line) => `• ${line}`)
        ].join('\n'));
      }

      if (!syncedEvent?.team || syncedEvent.discordMessageId) continue;
      if (!isWithinDays(syncedEvent.date, 14)) continue;

      const configIssue = getAttendanceConfigIssue(config, syncedEvent.team);
      if (configIssue) {
        await warnMissingAttendanceConfig(syncedEvent.team, configIssue);
        continue;
      }

      clearAttendanceWarning(syncedEvent.team, `Team setup incomplete for ${syncedEvent.team}. Missing: ${getTeamSetupProgress(config, syncedEvent.team).missing.join(', ')}`);

      await postEventMessage(syncedWithId);
      postedCount += 1;
      console.log(`Posted new event: ${syncedEvent.title} (${event.id})`);
    }

    if (config.googleSync?.enabled && config.googleSync?.autoFullSync) {
      const latestDb = loadDb();
      await syncAllToSheet(config, latestDb);
    }

    return { ok: true, totalEvents: calendarEvents.length, postedCount };
  } catch (error) {
    console.error('Calendar sync failed:', error);
    await sendLog(`❌ Calendar sync failed: ${error.message}`);
    if (options.throwOnError) throw error;
    return { ok: false, totalEvents: 0, postedCount: 0, error: error.message };
  }
}

client.on('interactionCreate', async (interaction) => {
  try {
    if (await handleSetupInteraction(interaction)) return;
    if (interaction.isButton() && interaction.customId.startsWith('coach_team_delivery_mode:')) {
      const team = interaction.customId.split(':')[1] || '';
      const coachRoleId = getConfig().roles?.[team]?.coach;
      if (!team || !coachRoleId || !interaction.member?.roles?.cache?.has(coachRoleId)) {
        await interaction.reply({ content: 'Only coaches for this team can change team delivery settings.', flags: MessageFlags.Ephemeral });
        return;
      }
      const config = getConfig();
      const current = config.channels?.teamDeliveryMode?.[team] || 'team_chat';
      const next = current === 'bot_commands' ? 'team_chat' : 'bot_commands';
      updateConfig(`channels.teamDeliveryMode.${team}`, next);
      const botCommandsId = getConfig().channels?.botCommands || '';
      await interaction.reply({
        content: next === 'bot_commands'
          ? `✅ Team fixture announcements for **${team}** will now post in ${botCommandsId ? `<#${botCommandsId}>` : 'the Bot Commands channel once configured'}.`
          : `✅ Team fixture announcements for **${team}** will now post in that team's chat channel.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('coach_notification_mode:')) {
      const team = interaction.customId.split(':')[1] || '';
      const coachRoleId = getConfig().roles?.[team]?.coach;
      if (!team || !coachRoleId || !interaction.member?.roles?.cache?.has(coachRoleId)) {
        await interaction.reply({ content: 'Only coaches for this team can change coach notification settings.', flags: MessageFlags.Ephemeral });
        return;
      }
      const profile = getPlayerProfile(interaction.user.id) || {};
      const current = profile.coachAttendanceDeliveryMode || 'team_staff_chat';
      const next = current === 'dm' ? 'team_staff_chat' : 'dm';
      upsertPlayerProfile(interaction.user.id, { coachAttendanceDeliveryMode: next });
      await interaction.reply({
        content: next === 'dm'
          ? '✅ Coach attendance reminders will now be sent to your **DM**.'
          : '✅ Coach attendance reminders will now be posted to your **team staff chat** only for you to review.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (interaction.isButton() && (
      interaction.customId.startsWith('coach_manage_profile:')
      || interaction.customId.startsWith('coach_manage_events:')
      || interaction.customId.startsWith('coach_next_event:')
      || interaction.customId.startsWith('coach_open_player_chat:')
    )) {
      await interaction.reply({
        content: '🚧 This coach workflow is now mapped in the UI and will be connected to full management flows next.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'player_delivery_mode') {
      const profile = getPlayerProfile(interaction.user.id) || {};
      const current = profile.notificationDeliveryMode || 'team_default';
      const next = current === 'dm' ? 'team_default' : 'dm';
      upsertPlayerProfile(interaction.user.id, { notificationDeliveryMode: next });
      await interaction.reply({
        content: next === 'dm'
          ? '✅ Your preference is now **Direct Message only** for personal bot updates.'
          : '✅ Your preference is now **Team default channel** (uses your team delivery settings).',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

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
    console.error('Interaction handling failed:', formatInteractionError(error));
    const isAlreadyAcknowledged = error?.code === 40060 || /already been acknowledged/i.test(String(error?.message || ''));
    if (shouldSendAdminErrorReport(interaction)) {
      await sendAdminErrorReport(error, interaction);
    }
    if (!isAlreadyAcknowledged) {
      await sendLog(`❌ Interaction failed: ${error.message}\n${summarizeInteractionContext(interaction)}`, interaction?.channelId);
    }

    const isUnknownInteraction = error?.code === 10062;
    if (!isAlreadyAcknowledged && !isUnknownInteraction && interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ content: `Something went wrong. Error logged to the configured logs channel.\nReason: ${error.message}`, flags: MessageFlags.Ephemeral });
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
