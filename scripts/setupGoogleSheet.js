#!/usr/bin/env node
const { google } = require('googleapis');

function parseSpreadsheetId(input = '') {
  if (!input) return '';

  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];

  return input;
}

function getCredentialsPath() {
  return process.env.CALENDAR_CREDENTIALS_PATH
    || process.env.GOOGLE_APPLICATION_CREDENTIALS
    || 'credentials.json';
}

function requiredHeaders() {
  return {
    Fixtures: ['eventId', 'title', 'date', 'team', 'discordMessageId', 'updatedAt'],
    'Mens Fixtures': ['eventId', 'title', 'date', 'team', 'discordMessageId', 'updatedAt'],
    'Womens Fixtures': ['eventId', 'title', 'date', 'team', 'discordMessageId', 'updatedAt'],
    Attendance: ['eventId', 'userId', 'username', 'team', 'status', 'updatedAt'],
    Config: ['key', 'value', 'updatedAt'],
    'Config IDs': ['key', 'value', 'updatedAt']
  };
}

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: getCredentialsPath(),
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file'
    ]
  });

  return google.sheets({ version: 'v4', auth });
}

async function ensureSheetsExist(sheetsApi, spreadsheetId, sheetTitles) {
  const metadata = await sheetsApi.spreadsheets.get({ spreadsheetId });
  const existing = new Set((metadata.data.sheets || []).map((s) => s.properties?.title).filter(Boolean));

  const addRequests = sheetTitles
    .filter((title) => !existing.has(title))
    .map((title) => ({ addSheet: { properties: { title } } }));

  if (addRequests.length) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: addRequests }
    });
  }
}

async function writeHeaders(sheetsApi, spreadsheetId, headersBySheet) {
  const data = Object.entries(headersBySheet).map(([title, headers]) => ({
    range: `${title}!A1:${String.fromCharCode(64 + headers.length)}1`,
    majorDimension: 'ROWS',
    values: [headers]
  }));

  await sheetsApi.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data
    }
  });

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: Object.keys(headersBySheet).map((title) => ({
        updateSheetProperties: {
          properties: { title, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount'
        }
      }))
    }
  });
}

async function main() {
  const input = process.argv[2] || process.env.GOOGLE_SPREADSHEET_ID || '';
  const spreadsheetId = parseSpreadsheetId(input);

  if (!spreadsheetId) {
    console.error('Usage: node scripts/setupGoogleSheet.js <spreadsheet-id-or-url>');
    process.exit(1);
  }

  const sheetsApi = await getSheetsClient();
  const headersBySheet = requiredHeaders();
  const sheetTitles = Object.keys(headersBySheet);

  await ensureSheetsExist(sheetsApi, spreadsheetId, sheetTitles);
  await writeHeaders(sheetsApi, spreadsheetId, headersBySheet);

  console.log(`Google Sheet is initialized: ${spreadsheetId}`);
  console.log(`Tabs ready: ${sheetTitles.join(', ')}`);
}

main().catch((error) => {
  console.error('Failed to initialize Google Sheet:', error.message);
  process.exit(1);
});
