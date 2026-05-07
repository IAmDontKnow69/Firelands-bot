const cron = require('node-cron');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { loadDb, markPostEventReminder, markAttendanceNoResponseReminder } = require('./database');
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
      const user = await client.users.fetch(userId).catch(() => null);
      const message = await user?.send({
        content: buildNoResponseReminderContent(event, userId, config),
        components: [createAttendanceResponseRow(eventId, userId)]
      }).catch(() => null);
      if (message) markAttendanceNoResponseReminder(eventId, userId);
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
  buildNoResponseReminderContent,
  shouldSendNoResponseReminder
};
