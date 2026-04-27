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

function compactText(value = '', max = 80) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
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

function sanitizeSheetTitle(value = '') {
  return String(value || '')
    .replace(/[\\/?*\[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 95);
}

function getRangeStartRow(range = '') {
  const match = String(range).match(/![A-Z]+(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : 2;
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

function splitIntoCellChunks(value = '', maxChars = 45000) {
  const text = String(value || '');
  if (!text) return [''];
  const chunks = [];
  for (let index = 0; index < text.length; index += maxChars) {
    chunks.push(text.slice(index, index + maxChars));
  }
  return chunks;
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

function getNestedValue(obj = {}, path = '') {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), obj);
}

function setNestedValue(obj = {}, path = '', value = '') {
  const keys = String(path || '').split('.').filter(Boolean);
  if (!keys.length) return;
  let pointer = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (!pointer[key] || typeof pointer[key] !== 'object' || Array.isArray(pointer[key])) pointer[key] = {};
    pointer = pointer[key];
  }
  pointer[keys[keys.length - 1]] = value;
}

function parseConfigValue(rawValue = '', template) {
  const text = String(rawValue ?? '').trim();
  if (Array.isArray(template)) {
    if (!text) return [];
    return text.split(',').map((part) => part.trim()).filter(Boolean);
  }
  if (typeof template === 'boolean') {
    return text.toLowerCase() === 'true';
  }
  if (typeof template === 'number') {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : template;
  }
  return String(rawValue ?? '');
}

async function loadConfigFromSheet(config = {}) {
  const spreadsheetId = getSpreadsheetId(config);
  if (!spreadsheetId) return null;

  const sheets = await getSheetsClient(config);
  const configRange = config.googleSync?.configRange || 'Config!A2:C';
  const configIdsRange = config.googleSync?.configIdsRange || 'Config IDs!A2:C';
  const [configRowsResponse, configIdsRowsResponse] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: configRange }).catch(() => ({ data: { values: [] } })),
    sheets.spreadsheets.values.get({ spreadsheetId, range: configIdsRange }).catch(() => ({ data: { values: [] } }))
  ]);

  const configRows = configRowsResponse.data.values || [];
  if (!configRows.length) return null;

  const idRows = configIdsRowsResponse.data.values || [];
  const idOverrides = new Map(idRows.map((row) => [row[0], row[1] || '']).filter(([key]) => key));
  const merged = JSON.parse(JSON.stringify(config || {}));

  for (const row of configRows) {
    const key = row[0];
    if (!key || key.startsWith('_')) continue;
    const template = getNestedValue(merged, key);
    const rawValue = idOverrides.has(key) ? idOverrides.get(key) : (row[1] || '');
    setNestedValue(merged, key, parseConfigValue(rawValue, template));
  }

  return merged;
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
      compactText(event.title, 70),
      event.date,
      compactText(event.location, 60),
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
      compactText(profile.customName || '', 40),
      compactText(profile.nickName || '', 40),
      profile.gender || '',
      profile.shirtNumber || '',
      profile.shirtNumbers && typeof profile.shirtNumbers === 'object'
        ? Object.entries(profile.shirtNumbers).map(([team, shirt]) => `${team}:${shirt}`).join(', ')
        : '',
      Array.isArray(profile.teams) ? profile.teams.join(',') : '',
      Array.isArray(profile.coachTeams) ? profile.coachTeams.join(',') : '',
      profile.coachPositions && typeof profile.coachPositions === 'object'
        ? Object.entries(profile.coachPositions).map(([team, title]) => `${team}:${title}`).join(', ')
        : '',
      Array.isArray(profile.roles)
        ? profile.roles.map((roleId) => roleNameMap.get(String(roleId)) || `Unknown (${truncateId(roleId)})`).join(', ')
        : '',
      profile.joinedDiscordAt || '',
      compactText(profile.notes || '', 80),
      profile.faceImageUrl || profile.facePngUrl || '',
      Array.isArray(profile.notesLog) ? compactText(profile.notesLog.map((note) => `[${note.createdAt || ''}] ${note.authorTag || note.authorId || 'unknown'}: ${note.text || ''}`).join(' | '), 500) : '',
      profile.updatedAt || toIso(),
      userId,
      compactText(JSON.stringify(profile || {}), 500)
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
      compactText(event.location || '', 60),
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
  const renameRequests = [];
  for (const section of sections) {
    const title = getSheetNameFromRange(section.range);
    if (existingSheets.has(title)) continue;
    const aliases = Array.isArray(section.aliases) ? section.aliases : [];
    const aliasTitle = aliases.find((candidate) => candidate && existingSheets.has(candidate) && !existingSheets.has(title));
    if (aliasTitle) {
      const aliasSheetId = existingSheets.get(aliasTitle);
      if (Number.isInteger(aliasSheetId)) {
        renameRequests.push({
          updateSheetProperties: {
            properties: { sheetId: aliasSheetId, title },
            fields: 'title'
          }
        });
      }
      continue;
    }
    addRequests.push({ addSheet: { properties: { title } } });
  }

  if (renameRequests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: renameRequests }
    });
  }

  if (addRequests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: addRequests }
    });
  }

  if (renameRequests.length || addRequests.length) {
    const refreshed = await sheets.spreadsheets.get({ spreadsheetId });
    existingSheets.clear();
    for (const sheet of refreshed.data.sheets || []) {
      const title = sheet.properties?.title;
      const sheetId = sheet.properties?.sheetId;
      if (title && Number.isInteger(sheetId)) existingSheets.set(title, sheetId);
    }
  }

  const headerUpdates = sections.map((section) => {
    const title = getSheetNameFromRange(section.range);
    const headers = section.headers || [];
    const startRow = Math.max(1, getRangeStartRow(section.range) - 1);
    const endColumn = toColumnLabel(headers.length);
    return {
      range: `${title}!A${startRow}:${endColumn}${startRow}`,
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

  const tabColors = {
    Home: { red: 0.2, green: 0.55, blue: 0.95 },
    Fixtures: { red: 0.22, green: 0.62, blue: 0.3 },
    'Mens Fixtures': { red: 0.18, green: 0.4, blue: 0.85 },
    'Womens Fixtures': { red: 0.82, green: 0.28, blue: 0.36 },
    Attendance: { red: 0.56, green: 0.37, blue: 0.78 },
    Config: { red: 0.46, green: 0.46, blue: 0.46 },
    'Config IDs': { red: 0.3, green: 0.3, blue: 0.3 },
    'Config Backups': { red: 0.85, green: 0.56, blue: 0.2 },
    'Player and Coach Management': { red: 0.17, green: 0.67, blue: 0.67 },
    Absences: { red: 0.9, green: 0.45, blue: 0.2 },
    'Player and Coach Notes': { red: 0.52, green: 0.42, blue: 0.73 },
    Backups: { red: 0.95, green: 0.71, blue: 0.12 }
  };

  const formatRequests = sections
    .map((section) => {
      const title = getSheetNameFromRange(section.range);
      const sheetId = existingSheets.get(title);
      if (!Number.isInteger(sheetId)) return null;
      const headerCount = (section.headers || []).length;
      const startRow = Math.max(1, getRangeStartRow(section.range) - 1);
      const tabColor = tabColors[title];
      return [
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: { frozenRowCount: startRow },
              ...(tabColor ? { tabColorStyle: { rgbColor: tabColor } } : {})
            },
            fields: `gridProperties.frozenRowCount${tabColor ? ',tabColorStyle' : ''}`
          }
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: startRow - 1,
              endRowIndex: startRow,
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
        },
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId,
              dimension: 'COLUMNS',
              startIndex: 0,
              endIndex: Math.max(headerCount, 1)
            }
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

async function writeTabNavigationRows(sheets, spreadsheetId, sections = [], sheetIdByTitle = new Map()) {
  if (!sections.length) return;

  const data = sections.map((section, index) => {
    const title = getSheetNameFromRange(section.range);
    const previous = sections[index - 1];
    const next = sections[index + 1];
    const homeGid = sheetIdByTitle.get('Home');
    const prevTitle = previous ? getSheetNameFromRange(previous.range) : '';
    const nextTitle = next ? getSheetNameFromRange(next.range) : '';
    const prevGid = prevTitle ? sheetIdByTitle.get(prevTitle) : null;
    const nextGid = nextTitle ? sheetIdByTitle.get(nextTitle) : null;
    const headerCount = Math.max((section.headers || []).length, 1);
    const startCol = toColumnLabel(headerCount + 1);
    const endCol = toColumnLabel(headerCount + 4);

    return {
      range: `${title}!${startCol}1:${endCol}1`,
      majorDimension: 'ROWS',
      values: [[
        homeGid ? `=HYPERLINK("#gid=${homeGid}", "🏠 Home")` : 'Home',
        prevGid ? `=HYPERLINK("#gid=${prevGid}", "⬅ Previous")` : '',
        nextGid ? `=HYPERLINK("#gid=${nextGid}", "Next ➜")` : '',
        section.description || ''
      ]]
    };
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data
    }
  });
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

function buildSheetsBackupSnapshot(config = {}, db = {}) {
  const snapshot = {
    createdAt: toIso(),
    config: JSON.parse(JSON.stringify(config || {})),
    db: JSON.parse(JSON.stringify(db || {}))
  };
  delete snapshot.config._configBackups;
  return snapshot;
}

async function loadSheetBackups(config = {}) {
  const spreadsheetId = getSpreadsheetId(config);
  if (!spreadsheetId) return [];
  const sheets = await getSheetsClient(config);
  const backupsRange = config.googleSync?.sheetBackupsRange || 'Backups!A2:F';
  const title = getSheetNameFromRange(backupsRange);

  await ensureSheetLayout(sheets, spreadsheetId, [
    { range: backupsRange, headers: ['slot', 'name', 'createdAt', 'createdBy', 'summary', 'snapshot'] }
  ]);

  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${title}!A2:ZZ` }).catch(() => ({ data: { values: [] } }));
  const rows = response.data.values || [];
  return rows
    .map((row) => ({
      slot: Number.parseInt(row[0] || '0', 10),
      name: row[1] || '',
      createdAt: row[2] || '',
      createdBy: row[3] || '',
      summary: row[4] || '',
      snapshot: row.slice(5).join('')
    }))
    .filter((entry) => Number.isInteger(entry.slot) && entry.slot >= 1 && entry.slot <= 5);
}

async function saveSheetBackupSlot(config = {}, { slot = 1, name = '', createdBy = '', summary = '', snapshot = '' } = {}) {
  const spreadsheetId = getSpreadsheetId(config);
  if (!spreadsheetId) return { ok: false, reason: 'missing_spreadsheet_id' };
  const sheets = await getSheetsClient(config);
  const backupsRange = config.googleSync?.sheetBackupsRange || 'Backups!A2:F';
  const title = getSheetNameFromRange(backupsRange);
  const row = Number(slot);
  if (!Number.isInteger(row) || row < 1 || row > 5) return { ok: false, reason: 'invalid_slot' };

  await ensureSheetLayout(sheets, spreadsheetId, [
    { range: backupsRange, headers: ['slot', 'name', 'createdAt', 'createdBy', 'summary', 'snapshot'] }
  ]);

  const snapshotChunks = splitIntoCellChunks(snapshot);
  const rowValues = [row, name, toIso(), createdBy, summary, ...snapshotChunks];
  const endCol = toColumnLabel(rowValues.length);

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${title}!A${row + 1}:ZZ${row + 1}`
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${title}!A${row + 1}:${endCol}${row + 1}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [rowValues]
    }
  });

  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const backupSheetId = (metadata.data.sheets || []).find((sheet) => sheet.properties?.title === title)?.properties?.sheetId;
  if (Number.isInteger(backupSheetId)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          updateDimensionProperties: {
            range: { sheetId: backupSheetId, dimension: 'COLUMNS', startIndex: 5, endIndex: 6 },
            properties: { hiddenByUser: true },
            fields: 'hiddenByUser'
          }
        }]
      }
    });
  }

  return { ok: true };
}

async function buildSpreadsheetBackupSnapshot(config = {}, onProgress) {
  const spreadsheetId = getSpreadsheetId(config);
  if (!spreadsheetId) return { ok: false, reason: 'missing_spreadsheet_id' };

  const sheets = await getSheetsClient(config);
  const backupsRange = config.googleSync?.sheetBackupsRange || 'Backups!A2:F';
  const backupsTabTitle = getSheetNameFromRange(backupsRange);
  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const targetSheets = (metadata.data.sheets || [])
    .map((entry) => entry.properties?.title)
    .filter((title) => title && title !== backupsTabTitle);

  const snapshot = { version: 1, createdAt: toIso(), tabs: [] };
  const startedAt = Date.now();

  for (let i = 0; i < targetSheets.length; i += 1) {
    const title = targetSheets[i];
    const escaped = String(title).replace(/'/g, "''");
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${escaped}'!A1:ZZZ`
    }).catch(() => ({ data: { values: [] } }));

    snapshot.tabs.push({ title, values: response.data.values || [] });

    if (typeof onProgress === 'function') {
      const completed = i + 1;
      const elapsedMs = Math.max(1, Date.now() - startedAt);
      const etaMs = Math.max(0, Math.round((elapsedMs / completed) * (targetSheets.length - completed)));
      onProgress({
        phase: 'backup',
        currentTab: title,
        completed,
        total: targetSheets.length,
        percent: Math.min(100, Math.round((completed / Math.max(targetSheets.length, 1)) * 100)),
        etaMs,
        tabs: targetSheets
      });
    }
  }

  return { ok: true, snapshot };
}

async function restoreSpreadsheetFromBackupSnapshot(config = {}, snapshot = {}, onProgress) {
  const spreadsheetId = getSpreadsheetId(config);
  if (!spreadsheetId) return { ok: false, reason: 'missing_spreadsheet_id' };
  const tabs = Array.isArray(snapshot?.tabs) ? snapshot.tabs : [];
  if (!tabs.length) return { ok: false, reason: 'empty_snapshot' };

  const sheets = await getSheetsClient(config);
  const backupsRange = config.googleSync?.sheetBackupsRange || 'Backups!A2:F';
  const backupsTabTitle = getSheetNameFromRange(backupsRange);

  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTitles = (metadata.data.sheets || [])
    .map((entry) => entry.properties?.title)
    .filter(Boolean);
  const existingSet = new Set(existingTitles);

  const addRequests = tabs
    .filter((tab) => tab.title && !existingSet.has(tab.title))
    .map((tab) => ({ addSheet: { properties: { title: tab.title } } }));

  if (addRequests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: addRequests } });
  }

  const refreshedMetadata = await sheets.spreadsheets.get({ spreadsheetId });
  const allNonBackupTitles = (refreshedMetadata.data.sheets || [])
    .map((entry) => entry.properties?.title)
    .filter((title) => title && title !== backupsTabTitle);

  if (allNonBackupTitles.length) {
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId,
      requestBody: {
        ranges: allNonBackupTitles.map((title) => `'${String(title).replace(/'/g, "''")}'!A1:ZZZ`)
      }
    });
  }

  const startedAt = Date.now();
  for (let i = 0; i < tabs.length; i += 1) {
    const tab = tabs[i];
    const values = Array.isArray(tab.values) ? tab.values : [];
    const escaped = String(tab.title || '').replace(/'/g, "''");
    if (values.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${escaped}'!A1`,
        valueInputOption: 'RAW',
        requestBody: { values }
      });
    }

    if (typeof onProgress === 'function') {
      const completed = i + 1;
      const elapsedMs = Math.max(1, Date.now() - startedAt);
      const etaMs = Math.max(0, Math.round((elapsedMs / completed) * (tabs.length - completed)));
      onProgress({
        phase: 'restore',
        currentTab: tab.title,
        completed,
        total: tabs.length,
        percent: Math.min(100, Math.round((completed / Math.max(tabs.length, 1)) * 100)),
        etaMs,
        tabs: tabs.map((entry) => entry.title)
      });
    }
  }

  return { ok: true, restoredTabs: tabs.length };
}

async function renameSheetTabForRange(config = {}, fromRange = '', toRange = '') {
  const spreadsheetId = getSpreadsheetId(config);
  if (!spreadsheetId) return { ok: false, reason: 'missing_spreadsheet_id' };
  const fromTitle = getSheetNameFromRange(fromRange);
  const toTitle = getSheetNameFromRange(toRange);
  if (!fromTitle || !toTitle || fromTitle === toTitle) return { ok: true, renamed: false };

  const sheets = await getSheetsClient(config);
  const metadata = await sheets.spreadsheets.get({ spreadsheetId });
  const allSheets = metadata.data.sheets || [];
  const source = allSheets.find((sheet) => sheet.properties?.title === fromTitle);
  const target = allSheets.find((sheet) => sheet.properties?.title === toTitle);
  if (!source?.properties?.sheetId || target) return { ok: true, renamed: false };

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        updateSheetProperties: {
          properties: { sheetId: source.properties.sheetId, title: toTitle },
          fields: 'title'
        }
      }]
    }
  });

  return { ok: true, renamed: true };
}

async function syncAllToSheet(config = {}, db = {}, options = {}) {
  const spreadsheetId = getSpreadsheetId(config);
  if (!spreadsheetId) return { ok: false, reason: 'missing_spreadsheet_id' };

  const sheets = await getSheetsClient(config);
  const fixturesRange = config.googleSync?.fixturesRange || 'Fixtures!A2:G';
  const commandLogRange = config.googleSync?.commandLogRange || 'Command Log!A2:I';
  const attendanceRange = config.googleSync?.attendanceRange || 'Attendance!A2:F';
  const configRange = config.googleSync?.configRange || 'Config!A2:C';
  const configIdsRange = config.googleSync?.configIdsRange || 'Config IDs!A2:C';
  const configBackupsRange = config.googleSync?.configBackupsRange || 'Config Backups!A2:F';
  const playersRange = config.googleSync?.playersRange || 'Player and Coach Management!A2:Q';
  const absencesRange = config.googleSync?.absencesRange || 'Absences!A2:Q';
  const playerCoachNotesRange = config.googleSync?.playerCoachNotesRange || 'Player and Coach Notes!A2:I';
  const fixtureHeaders = ['eventId', 'title', 'date', 'location', 'team', 'discordMessageId', 'updatedAt'];
  const teamFixtureSections = Object.keys(config.teams || {}).map((teamKey) => {
    const teamLabel = config.teams?.[teamKey]?.label || teamKey;
    const tabTitle = sanitizeSheetTitle(`${teamLabel} Fixtures`) || `${teamKey} Fixtures`;
    const mappedRange = config.googleSync?.teamFixturesRanges?.[teamKey] || '';
    const aliases = [
      mappedRange ? getSheetNameFromRange(mappedRange) : '',
      teamKey === 'mens' ? getSheetNameFromRange(config.googleSync?.mensFixturesRange || 'Mens Fixtures!A2:G') : '',
      teamKey === 'womens' ? getSheetNameFromRange(config.googleSync?.womensFixturesRange || 'Womens Fixtures!A2:G') : ''
    ].filter(Boolean);
    return {
      range: `${tabTitle}!A2:G`,
      headers: fixtureHeaders,
      description: `${teamLabel} fixtures only.`,
      teamKey,
      aliases
    };
  });

  const sections = [
    { range: 'Home!A2:E', headers: ['Tab', 'Purpose', 'Open', 'Previous', 'Next'], description: 'Navigation hub for every tab.' },
    { range: fixturesRange, headers: fixtureHeaders, description: 'All fixtures synced from events.' },
    { range: commandLogRange, headers: ['timestamp', 'source', 'command', 'subcommand', 'options', 'guildId', 'channelId', 'userId', 'username'], description: 'Slash command activity log.' },
    ...teamFixtureSections,
    { range: attendanceRange, headers: ['eventId', 'userId', 'username', 'team', 'status', 'updatedAt'], description: 'Attendance responses by event.' },
    { range: configRange, headers: ['key', 'value', 'updatedAt'], description: 'Flattened runtime configuration.' },
    { range: configIdsRange, headers: ['key', 'value', 'updatedAt'], description: 'Role / channel / team identifiers.' },
    { range: configBackupsRange, headers: ['backupOrder', 'timestamp', 'changedPath', 'reason', 'snapshotPreview', 'snapshot'], description: 'Last 5 config states before changes.' },
    { range: playersRange, headers: ['userIdPreview', 'customName', 'nickName', 'gender', 'shirtNumber', 'shirtNumbersByTeam', 'teams', 'coachTeams', 'coachPositionsByTeam', 'roles', 'joinedDiscordAt', 'notes', 'faceImageUrl', 'notesLog', 'updatedAt', 'userId', 'profileJson'], description: 'Player + coach management profiles, including team assignments, titles, and saved profile fields.' },
    { range: absencesRange, headers: ['ticketPreview', 'channelPreview', 'eventPreview', 'eventTitle', 'eventDate', 'eventLocation', 'team', 'playerPreview', 'playerName', 'attendanceStatus', 'reason', 'coachDecision', 'coachPreview', 'coachName', 'closedAt', 'createdAt', 'closedReason', 'ticketId', 'channelId', 'eventId', 'playerId', 'coachId'], description: 'Absence tickets and outcomes.' },
    { range: playerCoachNotesRange, headers: ['notePreview', 'openNote', 'name', 'profileType', 'noteSummary', 'hidden', 'authorTag', 'createdAt', 'updatedAt', 'noteId', 'userId', 'authorId', 'note'], description: 'Player and coach notes with quick-open links.' }
  ];

  const sheetIdByTitle = await ensureSheetLayout(sheets, spreadsheetId, sections);
  await writeTabNavigationRows(sheets, spreadsheetId, sections, sheetIdByTitle);

  await writeRange(sheets, spreadsheetId, fixturesRange, buildFixtureRows(db), options);
  for (const teamSection of teamFixtureSections) {
    await writeRange(sheets, spreadsheetId, teamSection.range, buildFixtureRowsForTeam(db, teamSection.teamKey), options);
  }
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
        range: { sheetId: playersSheetId, dimension: 'COLUMNS', startIndex: 15, endIndex: 17 },
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

  const sections = [
    { range: 'Home!A2:E', headers: ['Tab', 'Purpose', 'Open', 'Previous', 'Next'], description: 'Navigation hub for every tab.' },
    { range: configRange, headers: ['key', 'value', 'updatedAt'], description: 'Flattened runtime configuration.' },
    { range: configIdsRange, headers: ['key', 'value', 'updatedAt'], description: 'Role / channel / team identifiers.' },
    { range: configBackupsRange, headers: ['backupOrder', 'timestamp', 'changedPath', 'reason', 'snapshotPreview', 'snapshot'], description: 'Last 5 config states before changes.' }
  ];

  const sheetIdByTitle = await ensureSheetLayout(sheets, spreadsheetId, sections);
  await writeTabNavigationRows(sheets, spreadsheetId, sections, sheetIdByTitle);

  await writeRange(sheets, spreadsheetId, configRange, await buildMergedConfigRows(sheets, spreadsheetId, config, configRange));
  await writeRange(sheets, spreadsheetId, configIdsRange, await buildMergedConfigIdRows(sheets, spreadsheetId, config, configIdsRange));
  await writeRange(sheets, spreadsheetId, configBackupsRange, buildConfigBackupRows(config));
  await writeRange(sheets, spreadsheetId, 'Home!A2:E', buildHomeRows(sections.slice(1), sheetIdByTitle));

  return { ok: true, spreadsheetId };
}

module.exports = {
  getSheetsClient,
  loadAttendanceFromSheet,
  loadConfigFromSheet,
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
  buildSheetsBackupSnapshot,
  loadSheetBackups,
  saveSheetBackupSlot,
  buildSpreadsheetBackupSnapshot,
  restoreSpreadsheetFromBackupSnapshot,
  renameSheetTabForRange,
  syncAllToSheet,
  syncConfigOnlyToSheet
};
