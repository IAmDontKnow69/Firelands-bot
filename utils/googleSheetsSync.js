const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

function toIso(date = new Date()) {
  return new Date(date).toISOString();
}

function truncateId(id = '') {
  const value = String(id || '');
  if (!value) return '';
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function resolveCredentialsPath(config = {}) {
  const configuredPath = config.bot?.calendarCredentialsPath
    || process.env.CALENDAR_CREDENTIALS_PATH
    || process.env.GOOGLE_APPLICATION_CREDENTIALS
    || '';
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
    `Google credentials file not found for Sheets sync. Set CALENDAR_CREDENTIALS_PATH (or GOOGLE_APPLICATION_CREDENTIALS). Looked for: ${uniqueCandidates.join(', ')}`
  );
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

function columnLabelToIndex(label = '') {
  return String(label)
    .toUpperCase()
    .split('')
    .reduce((acc, ch) => (acc * 26) + (ch.charCodeAt(0) - 64), 0);
}

function expandRangeForValues(range = '', values = []) {
  const maxColumns = Math.max(0, ...values.map((row) => (Array.isArray(row) ? row.length : 0)));
  if (!maxColumns) return range;

  const match = String(range).match(/^(?<sheet>[^!]+)!(?<startCol>[A-Z]+)(?<startRow>\d+):(?<endCol>[A-Z]+)(?<endRow>\d+)?$/i);
  if (!match?.groups) return range;

  const { sheet, startCol, startRow, endCol, endRow } = match.groups;
  const startIndex = columnLabelToIndex(startCol);
  const currentEndIndex = columnLabelToIndex(endCol);
  const requiredEndIndex = startIndex + maxColumns - 1;
  if (requiredEndIndex <= currentEndIndex) return range;

  return `${sheet}!${startCol}${startRow}:${toColumnLabel(requiredEndIndex)}${endRow || ''}`;
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
      location: event.location || '',
      team: event.team || '',
      discordMessageId: event.discordMessageId || '',
      updatedAt: event.updatedAt || toIso()
    }))
    .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime())
    .map((event) => [
      event.eventId,
      event.title,
      event.date,
      event.location,
      event.team,
      event.discordMessageId,
      event.updatedAt
    ]);
}

function buildFixtureRowsForTeam(db = {}, team = '') {
  return buildFixtureRows(db).filter((row) => row[4] === team);
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
    if (key.startsWith('_')) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      entries.push(...flattenConfig(value, path));
      continue;
    }

    entries.push([path, String(value ?? ''), toIso()]);
  }

  return entries;
}

function buildConfigBackupRows(config = {}) {
  const backups = Array.isArray(config._configBackups) ? config._configBackups.slice(0, 5) : [];
  return backups.map((entry, index) => {
    const snapshot = String(entry.snapshot || '');
    const compact = snapshot
      ? snapshot.replace(/\s+/g, ' ').slice(0, 180)
      : '';
    return [
      index + 1,
      entry.timestamp || '',
      entry.changedPath || '',
      entry.reason || '',
      compact,
      snapshot
    ];
  });
}

function buildConfigIdRows(config = {}) {
  return flattenConfig(config).filter(([key]) => {
    if (key.startsWith('roles.') || key.startsWith('channels.')) return true;
    if (key.startsWith('teams.')) return true;
    if (key === 'bot.adminRoleId' || key === 'bot.calendarId') return true;
    if (key.startsWith('googleSync.')) return true;
    return false;
  });
}

function buildRoleNameMap(config = {}) {
  const map = new Map();
  const walk = (node, path = []) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node)) {
      const nextPath = [...path, key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        walk(value, nextPath);
        continue;
      }
      if (/^\d{8,25}$/.test(String(value || ''))) {
        map.set(String(value), nextPath.join(' / '));
      }
    }
  };

  walk(config.roles || {}, []);
  return map;
}

function buildPlayerRows(db = {}, config = {}) {
  const players = db.players || {};
  const roleNameMap = buildRoleNameMap(config);
  return Object.entries(players)
    .map(([userId, profile]) => ([
      truncateId(userId),
      profile.customName || '',
      profile.shirtNumber || '',
      Array.isArray(profile.teams) ? profile.teams.join(',') : '',
      Array.isArray(profile.roles)
        ? profile.roles.map((roleId) => roleNameMap.get(String(roleId)) || `Unknown (${truncateId(roleId)})`).join(', ')
        : '',
      profile.joinedDiscordAt || '',
      profile.notes || '',
      profile.facePngUrl || '',
      profile.updatedAt || toIso(),
      userId
    ]))
    .sort((a, b) => String(a[1] || a[0]).localeCompare(String(b[1] || b[0])));
}

function buildAbsenceRows(db = {}) {
  const rows = [];
  const tickets = db.absenceTickets || {};

  for (const [channelId, ticket] of Object.entries(tickets)) {
    const event = db.events?.[ticket.eventId] || {};
    const response = event.responses?.[ticket.playerId] || {};
    rows.push([
      truncateId(ticket.ticketId || channelId),
      truncateId(channelId),
      truncateId(ticket.eventId || ''),
      event.title || '',
      event.date || '',
      event.location || '',
      ticket.team || event.team || '',
      truncateId(ticket.playerId || ''),
      ticket.playerName || response.username || '',
      response.status || ticket.status || '',
      response.reason || ticket.reason || '',
      ticket.coachDecision || '',
      truncateId(ticket.coachId || ''),
      ticket.coachName || '',
      ticket.closedAt || '',
      ticket.createdAt || '',
      ticket.closedReason || '',
      ticket.ticketId || channelId,
      channelId,
      ticket.eventId || '',
      ticket.playerId || '',
      ticket.coachId || ''
    ]);
  }

  return rows.sort((a, b) => new Date(a[15] || 0).getTime() - new Date(b[15] || 0).getTime());
}

function buildPlayerCoachNoteRows(db = {}, notesSheetId) {
  const rows = [];
  const players = db.players || {};
  let rowIndex = 2;
  for (const [userId, profile] of Object.entries(players)) {
    const notes = Array.isArray(profile.notesLog) ? profile.notesLog : [];
    for (const note of notes) {
      const noteCol = 'L';
      const openLink = Number.isInteger(notesSheetId)
        ? `=HYPERLINK("#gid=${notesSheetId}&range=${noteCol}${rowIndex}", "Open Note")`
        : 'Open Note';
      const fullNote = note.text || '';
      const summary = fullNote.length > 90 ? `${fullNote.slice(0, 87)}...` : fullNote;
      rows.push([
        truncateId(note.id || ''),
        openLink,
        profile.customName || '',
        note.profileType || 'player',
        summary,
        note.hidden ? 'true' : 'false',
        note.authorTag || '',
        note.createdAt || '',
        note.updatedAt || '',
        note.id || '',
        userId,
        note.authorId || '',
        fullNote
      ]);
      rowIndex += 1;
    }
  }
  return rows.sort((a, b) => new Date(a[7] || 0).getTime() - new Date(b[7] || 0).getTime());
}

function isPlaceholderConfigValue(key = '', value = '') {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.toLowerCase() === 'not set') return true;
  if (normalized === 'ROLE_ID') return true;
  if ((key.startsWith('roles.') || key.startsWith('channels.')) && !/^\d{8,25}$/.test(normalized)) return true;
  return false;
}

async function buildMergedConfigRows(sheets, spreadsheetId, config = {}, range = 'Config!A2:C') {
  const incomingRows = flattenConfig(config);
  const existingResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range }).catch(() => ({ data: { values: [] } }));
  const existingRows = existingResponse.data.values || [];
  const existingMap = new Map(existingRows.map((row) => [row[0], row]));
  const seenKeys = new Set();

  const mergedRows = incomingRows.map(([key, value, updatedAt]) => {
    seenKeys.add(key);
    if (isPlaceholderConfigValue(key, value) && existingMap.has(key)) {
      return [key, existingMap.get(key)?.[1] || '', updatedAt];
    }
    return [key, value, updatedAt];
  });

  for (const row of existingRows) {
    const key = row[0];
    if (!key || seenKeys.has(key)) continue;
    mergedRows.push([key, row[1] || '', row[2] || toIso()]);
  }

  return mergedRows;
}

async function buildMergedConfigIdRows(sheets, spreadsheetId, config = {}, range = 'Config IDs!A2:C') {
  const incomingRows = buildConfigIdRows(config);
  const existingResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range }).catch(() => ({ data: { values: [] } }));
  const existingRows = existingResponse.data.values || [];
  const existingMap = new Map(existingRows.map((row) => [row[0], row[1] || '']));
  const seenKeys = new Set();

  const mergedRows = incomingRows.map(([key, value, updatedAt]) => {
    seenKeys.add(key);
    if (isPlaceholderConfigValue(key, value) && existingMap.has(key)) {
      return [key, existingMap.get(key), updatedAt];
    }
    return [key, value, updatedAt];
  });

  for (const row of existingRows) {
    const key = row[0];
    if (!key || seenKeys.has(key)) continue;
    mergedRows.push([key, row[1] || '', row[2] || toIso()]);
  }

  return mergedRows;
}

async function writeRange(sheets, spreadsheetId, range, values, options = {}) {
  const effectiveRange = expandRangeForValues(range, values);

  if (options.wipe) {
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: effectiveRange });
  }
  if (!values.length) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: effectiveRange,
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

  return existingSheets;
}

function buildHomeRows(sections = [], sheetIdByTitle = new Map()) {
  if (!sections.length) return [];

  return sections.map((section, index) => {
    const previous = sections[index - 1];
    const next = sections[index + 1];
    const title = getSheetNameFromRange(section.range);
    const previousLink = previous
      ? `=HYPERLINK("#gid=${sheetIdByTitle.get(getSheetNameFromRange(previous.range))}", "⬅ Previous")`
      : '';
    const nextLink = next
      ? `=HYPERLINK("#gid=${sheetIdByTitle.get(getSheetNameFromRange(next.range))}", "Next ➜")`
      : '';
    return [
      title,
      section.description || '',
      `=HYPERLINK("#gid=${sheetIdByTitle.get(title)}", "Open Tab")`,
      previousLink,
      nextLink
    ];
  });
}

async function syncAllToSheet(config = {}, db = {}, options = {}) {
  const spreadsheetId = getSpreadsheetId(config);
  if (!spreadsheetId) return { ok: false, reason: 'missing_spreadsheet_id' };

  const sheets = await getSheetsClient(config);
  const fixturesRange = config.googleSync?.fixturesRange || 'Fixtures!A2:G';
  const commandLogRange = config.googleSync?.commandLogRange || 'Command Log!A2:I';
  const mensFixturesRange = config.googleSync?.mensFixturesRange || 'Mens Fixtures!A2:G';
  const womensFixturesRange = config.googleSync?.womensFixturesRange || 'Womens Fixtures!A2:G';
  const attendanceRange = config.googleSync?.attendanceRange || 'Attendance!A2:F';
  const configRange = config.googleSync?.configRange || 'Config!A2:C';
  const configIdsRange = config.googleSync?.configIdsRange || 'Config IDs!A2:C';
  const configBackupsRange = config.googleSync?.configBackupsRange || 'Config Backups!A2:F';
  const playersRange = config.googleSync?.playersRange || 'Players!A2:I';
  const absencesRange = config.googleSync?.absencesRange || 'Absences!A2:Q';
  const playerCoachNotesRange = config.googleSync?.playerCoachNotesRange || 'Player and Coach Notes!A2:I';

  const sections = [
    { range: 'Home!A2:E', headers: ['Tab', 'Purpose', 'Open', 'Previous', 'Next'], description: 'Navigation hub for every tab.' },
    { range: fixturesRange, headers: ['eventId', 'title', 'date', 'location', 'team', 'discordMessageId', 'updatedAt'], description: 'All fixtures synced from events.' },
    { range: commandLogRange, headers: ['timestamp', 'source', 'command', 'subcommand', 'options', 'guildId', 'channelId', 'userId', 'username'], description: 'Slash command activity log.' },
    { range: mensFixturesRange, headers: ['eventId', 'title', 'date', 'location', 'team', 'discordMessageId', 'updatedAt'], description: 'Mens fixtures only.' },
    { range: womensFixturesRange, headers: ['eventId', 'title', 'date', 'location', 'team', 'discordMessageId', 'updatedAt'], description: 'Womens fixtures only.' },
    { range: attendanceRange, headers: ['eventId', 'userId', 'username', 'team', 'status', 'updatedAt'], description: 'Attendance responses by event.' },
    { range: configRange, headers: ['key', 'value', 'updatedAt'], description: 'Flattened runtime configuration.' },
    { range: configIdsRange, headers: ['key', 'value', 'updatedAt'], description: 'Role / channel / team identifiers.' },
    { range: configBackupsRange, headers: ['backupOrder', 'timestamp', 'changedPath', 'reason', 'snapshotPreview', 'snapshot'], description: 'Last 5 config states before changes.' },
    { range: playersRange, headers: ['userIdPreview', 'customName', 'shirtNumber', 'teams', 'roles', 'joinedDiscordAt', 'notes', 'facePngUrl', 'updatedAt', 'userId'], description: 'Player profiles and team assignments.' },
    { range: absencesRange, headers: ['ticketPreview', 'channelPreview', 'eventPreview', 'eventTitle', 'eventDate', 'eventLocation', 'team', 'playerPreview', 'playerName', 'attendanceStatus', 'reason', 'coachDecision', 'coachPreview', 'coachName', 'closedAt', 'createdAt', 'closedReason', 'ticketId', 'channelId', 'eventId', 'playerId', 'coachId'], description: 'Absence tickets and outcomes.' },
    { range: playerCoachNotesRange, headers: ['notePreview', 'openNote', 'name', 'profileType', 'noteSummary', 'hidden', 'authorTag', 'createdAt', 'updatedAt', 'noteId', 'userId', 'authorId', 'note'], description: 'Player and coach notes with quick-open links.' }
  ];

  const sheetIdByTitle = await ensureSheetLayout(sheets, spreadsheetId, sections);

  await writeRange(sheets, spreadsheetId, fixturesRange, buildFixtureRows(db), options);
  await writeRange(sheets, spreadsheetId, mensFixturesRange, buildFixtureRowsForTeam(db, 'mens'), options);
  await writeRange(sheets, spreadsheetId, womensFixturesRange, buildFixtureRowsForTeam(db, 'womens'), options);
  await writeRange(sheets, spreadsheetId, attendanceRange, buildAttendanceRows(db), options);
  await writeRange(sheets, spreadsheetId, configRange, flattenConfig(config), options);
  await writeRange(sheets, spreadsheetId, configIdsRange, await buildMergedConfigIdRows(sheets, spreadsheetId, config, configIdsRange), options);
  await writeRange(sheets, spreadsheetId, configBackupsRange, buildConfigBackupRows(config), options);
  await writeRange(sheets, spreadsheetId, playersRange, buildPlayerRows(db, config), options);
  await writeRange(sheets, spreadsheetId, absencesRange, buildAbsenceRows(db), options);
  await writeRange(
    sheets,
    spreadsheetId,
    playerCoachNotesRange,
    buildPlayerCoachNoteRows(db, sheetIdByTitle.get(getSheetNameFromRange(playerCoachNotesRange))),
    options
  );
  await writeRange(sheets, spreadsheetId, 'Home!A2:E', buildHomeRows(sections.slice(1), sheetIdByTitle), options);

  const hiddenColumnsRequests = [];
  const playersSheetId = sheetIdByTitle.get(getSheetNameFromRange(playersRange));
  if (Number.isInteger(playersSheetId)) {
    hiddenColumnsRequests.push({
      updateDimensionProperties: {
        range: { sheetId: playersSheetId, dimension: 'COLUMNS', startIndex: 9, endIndex: 10 },
        properties: { hiddenByUser: true },
        fields: 'hiddenByUser'
      }
    });
  }
  const absencesSheetId = sheetIdByTitle.get(getSheetNameFromRange(absencesRange));
  if (Number.isInteger(absencesSheetId)) {
    hiddenColumnsRequests.push({
      updateDimensionProperties: {
        range: { sheetId: absencesSheetId, dimension: 'COLUMNS', startIndex: 17, endIndex: 22 },
        properties: { hiddenByUser: true },
        fields: 'hiddenByUser'
      }
    });
  }
  const notesSheetId = sheetIdByTitle.get(getSheetNameFromRange(playerCoachNotesRange));
  if (Number.isInteger(notesSheetId)) {
    hiddenColumnsRequests.push({
      updateDimensionProperties: {
        range: { sheetId: notesSheetId, dimension: 'COLUMNS', startIndex: 9, endIndex: 13 },
        properties: { hiddenByUser: true },
        fields: 'hiddenByUser'
      }
    });
  }
  const configBackupsSheetId = sheetIdByTitle.get(getSheetNameFromRange(configBackupsRange));
  if (Number.isInteger(configBackupsSheetId)) {
    hiddenColumnsRequests.push({
      updateDimensionProperties: {
        range: { sheetId: configBackupsSheetId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 },
        properties: { hiddenByUser: true },
        fields: 'hiddenByUser'
      }
    });
  }

  if (hiddenColumnsRequests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: hiddenColumnsRequests }
    });
  }

  return { ok: true, spreadsheetId };
}

async function syncConfigOnlyToSheet(config = {}) {
  const spreadsheetId = getSpreadsheetId(config);
  if (!spreadsheetId) return { ok: false, reason: 'missing_spreadsheet_id' };

  const sheets = await getSheetsClient(config);
  const configRange = config.googleSync?.configRange || 'Config!A2:C';
  const configIdsRange = config.googleSync?.configIdsRange || 'Config IDs!A2:C';
  const configBackupsRange = config.googleSync?.configBackupsRange || 'Config Backups!A2:F';

  await ensureSheetLayout(sheets, spreadsheetId, [
    { range: configRange, headers: ['key', 'value', 'updatedAt'] },
    { range: configIdsRange, headers: ['key', 'value', 'updatedAt'] },
    { range: configBackupsRange, headers: ['backupOrder', 'timestamp', 'changedPath', 'reason', 'snapshotPreview', 'snapshot'] }
  ]);

  await writeRange(sheets, spreadsheetId, configRange, await buildMergedConfigRows(sheets, spreadsheetId, config, configRange));
  await writeRange(sheets, spreadsheetId, configIdsRange, await buildMergedConfigIdRows(sheets, spreadsheetId, config, configIdsRange));
  await writeRange(sheets, spreadsheetId, configBackupsRange, buildConfigBackupRows(config));

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
  buildPlayerRows,
  buildAbsenceRows,
  buildPlayerCoachNoteRows,
  flattenConfig,
  buildConfigIdRows,
  buildMergedConfigRows,
  ensureSheetLayout,
  syncAllToSheet,
  syncConfigOnlyToSheet
};
