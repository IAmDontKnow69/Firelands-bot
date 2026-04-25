const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data.json');

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify({ events: {}, futureAvailability: {}, absenceTickets: {}, players: {}, meta: { postEventCoachReminders: {} } }, null, 2)
    );
  }
}

function loadDb() {
  ensureDb();

  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed.events) parsed.events = {};
    if (!parsed.futureAvailability) parsed.futureAvailability = {};
    if (!parsed.absenceTickets) parsed.absenceTickets = {};
    if (!parsed.players) parsed.players = {};
    if (!parsed.meta) parsed.meta = {};
    if (!parsed.meta.postEventCoachReminders) parsed.meta.postEventCoachReminders = {};

    return parsed;
  } catch (error) {
    console.error('Failed to load database:', error);
    return { events: {}, futureAvailability: {}, absenceTickets: {}, players: {}, meta: { postEventCoachReminders: {} } };
  }
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function upsertEvent(eventId, payload) {
  const db = loadDb();

  db.events[eventId] = {
    ...(db.events[eventId] || {}),
    ...payload,
    updatedAt: new Date().toISOString(),
    responses: (db.events[eventId] && db.events[eventId].responses) || payload.responses || {}
  };

  saveDb(db);
  return db.events[eventId];
}

function setEventMessageId(eventId, messageId) {
  const db = loadDb();
  if (!db.events[eventId]) return;

  db.events[eventId].discordMessageId = messageId;
  saveDb(db);
}

function setResponse(eventId, userId, response) {
  const db = loadDb();
  if (!db.events[eventId]) return null;

  if (!db.events[eventId].responses) db.events[eventId].responses = {};

  db.events[eventId].responses[userId] = {
    ...(db.events[eventId].responses[userId] || {}),
    ...response
  };

  saveDb(db);
  return db.events[eventId].responses[userId];
}

function clearResponse(eventId, userId) {
  const db = loadDb();
  if (!db.events[eventId]?.responses?.[userId]) return false;
  delete db.events[eventId].responses[userId];
  saveDb(db);
  return true;
}

function markPostEventReminder(eventId, marked = true) {
  const db = loadDb();
  db.meta.postEventCoachReminders[eventId] = marked;
  saveDb(db);
}

function setFutureAvailability(userId, team, date, payload) {
  const db = loadDb();
  if (!db.futureAvailability[userId]) db.futureAvailability[userId] = {};
  if (!db.futureAvailability[userId][team]) db.futureAvailability[userId][team] = {};

  db.futureAvailability[userId][team][date] = {
    ...(db.futureAvailability[userId][team][date] || {}),
    ...payload
  };

  saveDb(db);
  return db.futureAvailability[userId][team][date];
}

function setAbsenceTicket(channelId, payload) {
  const db = loadDb();
  db.absenceTickets[channelId] = {
    ...(db.absenceTickets[channelId] || {}),
    ...payload
  };
  saveDb(db);
  return db.absenceTickets[channelId];
}

function deleteAbsenceTicket(channelId) {
  const db = loadDb();
  if (!db.absenceTickets[channelId]) return false;
  db.absenceTickets[channelId] = {
    ...db.absenceTickets[channelId],
    status: 'closed',
    deleted: true,
    closedAt: db.absenceTickets[channelId].closedAt || new Date().toISOString()
  };
  saveDb(db);
  return true;
}

function upsertPlayerProfile(userId, payload = {}) {
  const db = loadDb();
  const current = db.players[userId] || {};
  db.players[userId] = {
    ...current,
    ...payload,
    updatedAt: new Date().toISOString()
  };
  saveDb(db);
  return db.players[userId];
}

function getPlayerProfile(userId) {
  const db = loadDb();
  return db.players[userId] || null;
}

function getPlayerDisplayName(userId, fallback = '') {
  const profile = getPlayerProfile(userId);
  return profile?.customName || fallback;
}

module.exports = {
  loadDb,
  saveDb,
  upsertEvent,
  setEventMessageId,
  setResponse,
  clearResponse,
  markPostEventReminder,
  setFutureAvailability,
  setAbsenceTicket,
  deleteAbsenceTicket,
  upsertPlayerProfile,
  getPlayerProfile,
  getPlayerDisplayName
};
