const cron = require('node-cron');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { loadDb, saveDb, setEventMessageRefs, markPostEventReminder, markAttendanceNoResponseReminder } = require('./database');
const { determineEventType, eventTypeLabel } = require('./eventType');

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

function hoursUntil(dateString) {
  const diff = new Date(dateString).getTime() - Date.now();
  return diff / ONE_HOUR_MS;
}

function createAttendanceResponseRow(eventId, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`attend_yes:${eventId}:${userId}`).setLabel('🟢 Attending').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`attend_no:${eventId}:${userId}`).setLabel('🔴 Not Attending').setStyle(ButtonStyle.Danger)
  );
}

function buildNoResponseReminderContent(event = {}, userId = '', config = {}) {
  const eventDate = new Date(event.date);
  const eventType = eventTypeLabel(determineEventType(event, config));
  return [
    `⏰ Hey <@${userId}>, this is your 24-hour attendance reminder.`,
    `You have not marked whether you are attending this **${eventType}** yet.`,
    '',
    `📅 **${event.title || 'Upcoming event'}**`,
    `🕒 ${eventDate.toLocaleString()}`,
    event.location ? `📍 ${event.location}` : null,
    '',
    'Please tap **Attending** or **Not Attending** before the event.'
  ].filter(Boolean).join('\n');
}

function memberHasRole(member, roleId = '') {
  return Boolean(roleId && roleId !== 'ROLE_ID' && member?.roles?.cache?.has(roleId));
}

function buildCoachAttendanceListContent(event = {}, eventId = '', config = {}, guild = null) {
  const team = event.team || '';
  const teamLabel = config.teams?.[team]?.label || team || 'Team';
  const getRoleIds = (roleId) => {
    const role = roleId ? guild?.roles?.cache?.get(roleId) : null;
    return role ? Array.from(role.members.keys()) : [];
  };
  const playerIds = getRoleIds(config.roles?.[team]?.player);
  const coachIds = getRoleIds(config.roles?.[team]?.coach);
  const formatStatus = (userId) => {
    const response = event.responses?.[userId];
    if (response?.status === 'yes') return '✅ Attending';
    if (['pending_no', 'confirmed_no'].includes(response?.status)) return `🔴 Not attending${response.reason ? ` — ${response.reason}` : ''}`;
    return '❓ No response';
  };
  const formatLines = (ids) => ids.length ? ids.map((id) => `• <@${id}> — ${formatStatus(id)}`).join('\n') : 'None found.';
  return [
    `📋 **Attendance List Reminder**`,
    `📅 **${event.title || 'Event'}** • ${teamLabel}`,
    `🕒 ${event.date ? new Date(event.date).toLocaleString() : 'Date not set'}`,
    '',
    '**Players**',
    formatLines(playerIds),
    '',
    '**Coaches**',
    formatLines(coachIds)
  ].join('\n');
}

function markCoachAttendanceListNotification(eventId = '', userId = '', hours = 0, ref = {}) {
  const db = loadDb();
  if (!db.meta) db.meta = {};
  if (!db.meta.coachAttendanceListNotifications) db.meta.coachAttendanceListNotifications = {};
  if (!db.meta.coachAttendanceListNotifications[eventId]) db.meta.coachAttendanceListNotifications[eventId] = {};
  if (!db.meta.coachAttendanceListNotifications[eventId][userId]) db.meta.coachAttendanceListNotifications[eventId][userId] = {};
  db.meta.coachAttendanceListNotifications[eventId][userId][String(hours)] = {
    ...ref,
    hours,
    sentAt: new Date().toISOString()
  };
  saveDb(db);
}

function coachAttendanceListNotificationSent(db = loadDb(), eventId = '', userId = '', hours = 0) {
  return Boolean(db.meta?.coachAttendanceListNotifications?.[eventId]?.[userId]?.[String(hours)]);
}

async function sendCoachAttendanceListNotifications(client, config) {
  const db = loadDb();
  const guild = await resolveReminderGuild(client, config);
  if (!guild) return;
  await guild.members.fetch().catch(() => null);

  for (const [eventId, event] of Object.entries(db.events || {})) {
    const eventTime = new Date(event.date).getTime();
    if (Number.isNaN(eventTime)) continue;
    const hoursToEvent = (eventTime - Date.now()) / ONE_HOUR_MS;
    if (hoursToEvent <= 0) continue;

    const coachRoleId = config.roles?.[event.team]?.coach;
    for (const [userId, profile] of Object.entries(db.players || {})) {
      const hours = Number(profile?.coachAttendanceListReminderHours || 0);
      if (![1, 5, 24].includes(hours)) continue;
      if (hoursToEvent > hours || coachAttendanceListNotificationSent(db, eventId, userId, hours)) continue;
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!memberHasRole(member, coachRoleId)) continue;
      const user = await client.users.fetch(userId).catch(() => null);
      const message = await user?.send({ content: buildCoachAttendanceListContent(event, eventId, config, guild) }).catch(() => null);
      if (message) markCoachAttendanceListNotification(eventId, userId, hours, { channelId: message.channelId || message.channel?.id || '', messageId: message.id });
    }
  }
}

async function fetchAttendanceMessageFromRef(client, ref = {}) {
  if (!ref?.messageId) return null;
  if (ref.delivery === 'dm' && ref.userId) {
    const user = await client.users.fetch(ref.userId).catch(() => null);
    const dm = await user?.createDM().catch(() => null);
    return dm?.messages.fetch(ref.messageId).catch(() => null);
  }
  if (ref.channelId) {
    const channel = await client.channels.fetch(ref.channelId).catch(() => null);
    return channel?.messages?.fetch(ref.messageId).catch(() => null);
  }
  return null;
}

async function editExistingAttendanceMessagesForUser(client, event = {}, eventId = '', userId = '', content = '') {
  const refs = Array.isArray(event.attendanceMessages) ? event.attendanceMessages : [];
  const targets = refs.filter((ref) => String(ref.userId || '') === String(userId || ''));
  const seen = new Set();
  let edited = 0;
  for (const ref of targets) {
    const key = `${ref.channelId || 'dm'}:${ref.messageId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const message = await fetchAttendanceMessageFromRef(client, ref);
    if (!message) continue;
    const ok = await message.edit({ content, components: [createAttendanceResponseRow(eventId, userId)] }).then(() => true).catch(() => false);
    if (ok) edited += 1;
  }
  return edited;
}

function appendAttendanceMessageRef(eventId = '', event = {}, ref = {}) {
  const latestEvent = loadDb().events?.[eventId] || event;
  const refs = Array.isArray(latestEvent.attendanceMessages) ? latestEvent.attendanceMessages : [];
  setEventMessageRefs(eventId, [...refs, ref]);
}

async function resolveReminderGuild(client, config = {}) {
  const guildId = config.bot?.guildId || process.env.DISCORD_GUILD_ID || '';
  if (guildId) {
    return client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  }
  const cachedGuilds = Array.from(client.guilds.cache.values());
  return cachedGuilds.length === 1 ? cachedGuilds[0] : null;
}

async function getReminderUserIds(client, config = {}, event = {}) {
  const ids = new Set(
    (Array.isArray(event.attendanceMessages) ? event.attendanceMessages : [])
      .map((ref) => String(ref?.userId || '').trim())
      .filter(Boolean)
  );

  const roleId = config.roles?.[event.team]?.player;
  if (roleId && roleId !== 'ROLE_ID') {
    const guild = await resolveReminderGuild(client, config);
    const role = guild
      ? guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null)
      : null;
    if (role) {
      if (!role.members?.size) await guild.members.fetch().catch(() => null);
      for (const memberId of role.members.keys()) ids.add(memberId);
    }
  }

  return Array.from(ids);
}

function shouldSendNoResponseReminder(event = {}, eventId = '', userId = '', db = loadDb()) {
  const eventTime = new Date(event.date).getTime();
  if (Number.isNaN(eventTime)) return false;
  const msUntil = eventTime - Date.now();
  if (msUntil <= 0 || msUntil > ONE_DAY_MS) return false;
  if (event.responses?.[userId]?.status) return false;
  return !db.meta?.attendanceNoResponseReminders?.[eventId]?.[userId];
}

async function sendNoResponseReminders(client, config) {
  const db = loadDb();
  for (const [eventId, event] of Object.entries(db.events || {})) {
    const userIds = await getReminderUserIds(client, config, event);
    for (const userId of userIds) {
      if (!shouldSendNoResponseReminder(event, eventId, userId, db)) continue;
      const content = buildNoResponseReminderContent(event, userId, config);
      await editExistingAttendanceMessagesForUser(client, event, eventId, userId, content);
      const user = await client.users.fetch(userId).catch(() => null);
      const message = await user?.send({
        content,
        components: [createAttendanceResponseRow(eventId, userId)]
      }).catch(() => null);
      if (message) {
        appendAttendanceMessageRef(eventId, event, { channelId: message.channelId || message.channel?.id || '', messageId: message.id, userId, delivery: 'dm' });
        markAttendanceNoResponseReminder(eventId, userId);
      }
    }
  }
}

async function sendPostEventCoachVerification(client, config) {
  void client;
  void config;
  const db = loadDb();
  for (const [eventId, event] of Object.entries(db.events)) {
    if (hoursUntil(event.date) <= -1) markPostEventReminder(eventId, true);
  }
}

function startReminderJobs(client, getConfig) {
  cron.schedule('0 * * * *', async () => {
    try {
      const config = getConfig();
      await sendNoResponseReminders(client, config);
      await sendCoachAttendanceListNotifications(client, config);
      await sendPostEventCoachVerification(client, config);
    } catch (error) {
      console.error('Reminder job failed:', error);
    }
  });
}

module.exports = {
  startReminderJobs,
  sendNoResponseReminders,
  sendPostEventCoachVerification,
  sendCoachAttendanceListNotifications,
  buildNoResponseReminderContent,
  buildCoachAttendanceListContent,
  shouldSendNoResponseReminder
};
