const { google } = require('googleapis');

function toIso(date = new Date()) {
  return new Date(date).toISOString();
}

function resolveCredentialsPath(config = {}) {
  return config.bot?.calendarCredentialsPath
    || process.env.CALENDAR_CREDENTIALS_PATH
    || process.env.GOOGLE_APPLICATION_CREDENTIALS
    || 'credentials.json';
}

function getSpreadsheetId(config = {}) {
  const input = config.googleSync?.spreadsheetId || process.env.GOOGLE_SPREADSHEET_ID || '';
  const match = String(input).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : String(input).trim();
}

function getSheetNameFromRange(range = '') {
  return String(range).split('!')[0].trim();
}

function toColumnLabel(index) {
  let n = index;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

async function getSheetsClient(config = {}) {
  const auth = new google.auth.GoogleAuth({
    keyFile: resolveCredentialsPath(config),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  return google.sheets({ version: 'v4', auth });
}

function mapAttendanceRow(row = []) {
  return {
    eventId: row[0] || '',
    userId: row[1] || '',
    username: row[2] || '',
    team: row[3] || '',
    status: row[4] || '',
    updatedAt: row[5] || ''
  };
}

async function loadAttendanceFromSheet(config = {}, range = 'Attendance!A2:F') {
  const spreadsheetId = getSpreadsheetId(config);
  if (!spreadsheetId) return [];

  const sheets = await getSheetsClient(config);
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });

  return (response.data.values || []).map(mapAttendanceRow);
}

async function appendAttendanceRow(config = {}, attendance = {}, range = 'Attendance!A2:F') {
  const spreadsheetId = getSpreadsheetId(config);
  if (!spreadsheetId) return false;

  const sheets = await getSheetsClient(config);
  const row = [
    attendance.eventId || '',
    attendance.userId || '',
    attendance.username || '',
    attendance.team || '',
    attendance.status || '',
    attendance.updatedAt || toIso()
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });

  return true;
}

async function appendCommandLogRow(config = {}, entry = {}) {
  const spreadsheetId = getSpreadsheetId(config);
  if (!spreadsheetId) return false;

  const range = config.googleSync?.commandLogRange || 'Command Log!A2:I';
  const sheets = await getSheetsClient(config);

  await ensureSheetLayout(sheets, spreadsheetId, [
    {
      range,
      headers: ['timestamp', 'source', 'command', 'subcommand', 'options', 'guildId', 'channelId', 'userId', 'username']
    }
  ]);

  const row = [
    entry.timestamp || toIso(),
    entry.source || 'slash',
    entry.command || '',
    entry.subcommand || '',
    entry.options || '',
    entry.guildId || '',
    entry.channelId || '',
    entry.userId || '',
    entry.username || ''
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });

  return true;
}

function normalizeAttendanceStatus(status = '') {
  if (status === 'yes') return 'attending';
  if (status === 'pending_no' || status === 'confirmed_no') return 'not_attending';
  return status || '';
}

function buildFixtureRows(db = {}) {
  return Object.entries(db.events || {})
    .map(([eventId, event]) => ({
      eventId,
      title: event.title || '',
      date: event.date || '',
      team: event.team || '',
      discordMessageId: event.discordMessageId || '',
      updatedAt: event.updatedAt || toIso()
    }))
    .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime())
    .map((event) => [
      event.eventId,
      event.title,
      event.date,
      event.team,
      event.discordMessageId,
      event.updatedAt
    ]);
}

function buildFixtureRowsForTeam(db = {}, team = '') {
  return buildFixtureRows(db).filter((row) => row[3] === team);
}

function buildAttendanceRows(db = {}) {
  const rows = [];
  const events = db.events || {};

  for (const [eventId, event] of Object.entries(events)) {
    const responses = event.responses || {};
    for (const [userId, response] of Object.entries(responses)) {
      rows.push([
        eventId,
        userId,
        response.username || '',
        event.team || '',
        normalizeAttendanceStatus(response.status || ''),
        response.updatedAt || toIso()
      ]);
    }
  }

  return rows.sort((a, b) => new Date(a[5] || 0).getTime() - new Date(b[5] || 0).getTime());
}

function flattenConfig(config = {}, prefix = '') {
  const entries = [];
  for (const [key, value] of Object.entries(config)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      entries.push(...flattenConfig(value, path));
      continue;
    }

    entries.push([path, String(value ?? ''), toIso()]);
  }

  return entries;
}

function buildConfigIdRows(config = {}) {
  const rows = [];
  const pushObjectRows = (obj = {}, prefix = '') => {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        pushObjectRows(value, path);
        continue;
      }

      rows.push([path, String(value ?? ''), toIso()]);
    }
  };

  pushObjectRows(config.roles || {}, 'roles');
  pushObjectRows(config.channels || {}, 'channels');
  return rows;
}

async function writeRange(sheets, spreadsheetId, range, values) {
  await sheets.spreadsheets.values.clear({ spreadsheetId, range });
  if (!values.length) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values }
  });
}

async function ensureSheetLayout(sheets, spreadsheetId, sections = []) {
  if (!sections.length) return;

  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheets = new Map(
    (metadata.data.sheets || [])
      .map((sheet) => [sheet.properties?.title, sheet.properties?.sheetId])
      .filter(([title, id]) => title && Number.isInteger(id))
  );

  const addRequests = [];
  for (const section of sections) {
    const title = getSheetNameFromRange(section.range);
    if (!existingSheets.has(title)) addRequests.push({ addSheet: { properties: { title } } });
  }

  if (addRequests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: addRequests }
    });

    const refreshed = await sheets.spreadsheets.get({ spreadsheetId });
    for (const sheet of refreshed.data.sheets || []) {
      const title = sheet.properties?.title;
      const sheetId = sheet.properties?.sheetId;
      if (title && Number.isInteger(sheetId)) existingSheets.set(title, sheetId);
    }
  }

  const headerUpdates = sections.map((section) => {
    const title = getSheetNameFromRange(section.range);
    const headers = section.headers || [];
    const endColumn = toColumnLabel(headers.length);
    return {
      range: `${title}!A1:${endColumn}1`,
      majorDimension: 'ROWS',
      values: [headers]
    };
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: headerUpdates
    }
  });

  const formatRequests = sections
    .map((section) => {
      const title = getSheetNameFromRange(section.range);
      const sheetId = existingSheets.get(title);
      if (!Number.isInteger(sheetId)) return null;
      const headerCount = (section.headers || []).length;
      return [
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount'
          }
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: headerCount
            },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.9, green: 0.93, blue: 0.97 }
              }
            },
            fields: 'userEnteredFormat(textFormat,backgroundColor)'
          }
        }
      ];
    })
    .filter(Boolean)
    .flat();

  if (formatRequests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: formatRequests }
    });
  }
}

async function syncAllToSheet(config = {}, db = {}) {
  const spreadsheetId = getSpreadsheetId(config);
  if (!spreadsheetId) return { ok: false, reason: 'missing_spreadsheet_id' };

  const sheets = await getSheetsClient(config);
  const fixturesRange = config.googleSync?.fixturesRange || 'Fixtures!A2:F';
  const commandLogRange = config.googleSync?.commandLogRange || 'Command Log!A2:I';
  const mensFixturesRange = config.googleSync?.mensFixturesRange || 'Mens Fixtures!A2:F';
  const womensFixturesRange = config.googleSync?.womensFixturesRange || 'Womens Fixtures!A2:F';
  const attendanceRange = config.googleSync?.attendanceRange || 'Attendance!A2:F';
  const configRange = config.googleSync?.configRange || 'Config!A2:C';
  const configIdsRange = config.googleSync?.configIdsRange || 'Config IDs!A2:C';

  await ensureSheetLayout(sheets, spreadsheetId, [
    { range: fixturesRange, headers: ['eventId', 'title', 'date', 'team', 'discordMessageId', 'updatedAt'] },
    { range: commandLogRange, headers: ['timestamp', 'source', 'command', 'subcommand', 'options', 'guildId', 'channelId', 'userId', 'username'] },
    { range: mensFixturesRange, headers: ['eventId', 'title', 'date', 'team', 'discordMessageId', 'updatedAt'] },
    { range: womensFixturesRange, headers: ['eventId', 'title', 'date', 'team', 'discordMessageId', 'updatedAt'] },
    { range: attendanceRange, headers: ['eventId', 'userId', 'username', 'team', 'status', 'updatedAt'] },
    { range: configRange, headers: ['key', 'value', 'updatedAt'] },
    { range: configIdsRange, headers: ['key', 'value', 'updatedAt'] }
  ]);

  await writeRange(sheets, spreadsheetId, fixturesRange, buildFixtureRows(db));
  await writeRange(sheets, spreadsheetId, mensFixturesRange, buildFixtureRowsForTeam(db, 'mens'));
  await writeRange(sheets, spreadsheetId, womensFixturesRange, buildFixtureRowsForTeam(db, 'womens'));
  await writeRange(sheets, spreadsheetId, attendanceRange, buildAttendanceRows(db));
  await writeRange(sheets, spreadsheetId, configRange, flattenConfig(config));
  await writeRange(sheets, spreadsheetId, configIdsRange, buildConfigIdRows(config));

  return { ok: true, spreadsheetId };
}

module.exports = {
  getSheetsClient,
  loadAttendanceFromSheet,
  appendAttendanceRow,
  appendCommandLogRow,
  mapAttendanceRow,
  getSpreadsheetId,
  buildFixtureRows,
  buildFixtureRowsForTeam,
  buildAttendanceRows,
  flattenConfig,
  buildConfigIdRows,
  ensureSheetLayout,
  syncAllToSheet
};
