const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

function detectTeamFromTitle(title = '') {
  const normalized = title.toLowerCase();

  // womens must be checked before mens because "womens" includes "mens"
  if (normalized.includes('womens')) return 'womens';
  if (normalized.includes('mens')) return 'mens';
  return null;
}

function getEventStartIso(event) {
  return event?.start?.dateTime || event?.start?.date || null;
}

async function fetchUpcomingEvents({ calendarId, daysAhead = 14, credentialsPath = '' }) {
  return fetchCalendarEvents({ calendarId, daysAhead, credentialsPath });
}

async function fetchCalendarEvents({ calendarId, daysAhead = 14, credentialsPath = '' }) {
  const now = new Date();
  const hasDaysAheadLimit = typeof daysAhead === 'number' && Number.isFinite(daysAhead) && daysAhead > 0;
  const max = hasDaysAheadLimit ? new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000) : null;

  let items = [];
  try {
    const resolvedCredentialsPath = resolveCredentialsPath(credentialsPath);

    const auth = new google.auth.GoogleAuth({
      keyFile: resolvedCredentialsPath,
      scopes: ['https://www.googleapis.com/auth/calendar.readonly']
    });

    const calendar = google.calendar({ version: 'v3', auth });
    const response = await calendar.events.list({
      calendarId,
      timeMin: now.toISOString(),
      ...(max ? { timeMax: max.toISOString() } : {}),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500
    });

    items = response.data.items || [];
  } catch (error) {
    try {
      items = await fetchPublicCalendarEvents({ calendarId, now, max });
      if (!items.length) throw error;
    } catch (publicError) {
      throw new Error(`Unable to load Google Calendar with service credentials or public ICS feed: ${publicError.message}`);
    }
  }

  return items
    .map((event) => {
      const startIso = getEventStartIso(event);
      const title = event.summary || 'Untitled Event';
      const team = detectTeamFromTitle(title);

      if (!event.id || !startIso) return null;

      return {
        id: event.id,
        title,
        date: startIso,
        team
      };
    })
    .filter(Boolean);
}

async function fetchPublicCalendarEvents({ calendarId, now, max }) {
  if (!calendarId) return [];

  const publicUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
  const response = await fetch(publicUrl);
  if (!response.ok) return [];

  const icsText = await response.text();
  const lines = icsText.replace(/\r\n/g, '\n').split('\n');

  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }

    if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }

    if (!current) continue;

    if (line.startsWith('UID:')) current.id = line.slice(4).trim();
    if (line.startsWith('SUMMARY:')) current.summary = line.slice(8).trim();

    if (line.startsWith('DTSTART')) {
      const [, rawValue = ''] = line.split(':');
      current.start = parseIcsStart(rawValue.trim());
    }
  }

  return events.filter((event) => {
    const eventDate = getEventStartIso(event);
    if (!eventDate) return false;
    const start = new Date(eventDate);
    if (Number.isNaN(start.getTime())) return false;
    if (start < now) return false;
    if (max && start > max) return false;
    return true;
  });
}

function parseIcsStart(value) {
  if (!value) return {};

  if (/^\d{8}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));
    return { date: new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10) };
  }

  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return {};

  const [, year, month, day, hour, minute, second] = match;
  return {
    dateTime: new Date(Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    )).toISOString()
  };
}

function resolveCredentialsPath(credentialsPath = '') {
  const configuredPath = credentialsPath || process.env.CALENDAR_CREDENTIALS_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectRoot = path.join(__dirname, '..');

  const candidates = [
    configuredPath,
    configuredPath ? path.resolve(process.cwd(), configuredPath) : '',
    configuredPath ? path.resolve(projectRoot, configuredPath) : '',
    path.join(process.cwd(), 'credentials.json'),
    path.join(projectRoot, 'credentials.json')
  ].filter(Boolean);
  const uniqueCandidates = [...new Set(candidates)];

  const existingPath = uniqueCandidates.find((candidate) => fs.existsSync(candidate));
  if (existingPath) return existingPath;

  throw new Error(
    `Google Calendar credentials file not found. Set CALENDAR_CREDENTIALS_PATH (or GOOGLE_APPLICATION_CREDENTIALS) to an existing file. Looked for: ${uniqueCandidates.join(', ')}`
  );
}

module.exports = {
  fetchCalendarEvents,
  fetchUpcomingEvents,
  resolveCredentialsPath,
  detectTeamFromTitle,
  getEventStartIso
};
