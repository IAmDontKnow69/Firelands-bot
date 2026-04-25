const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function defaultConfig() {
  return {
    bot: {
      tokenReference: process.env.DISCORD_TOKEN || '',
      clientId: process.env.DISCORD_CLIENT_ID || '',
      guildId: process.env.DISCORD_GUILD_ID || '',
      adminRoleId: process.env.ADMIN_ROLE_ID || '',
      calendarId: process.env.CALENDAR_ID || 'hello@firelandsunited.com',
      calendarCredentialsPath: process.env.CALENDAR_CREDENTIALS_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS || 'credentials.json'
    },
    roles: {
      mens: {
        player: process.env.MENS_PLAYER_ROLE_ID || 'ROLE_ID',
        coach: process.env.MENS_COACH_ROLE_ID || 'ROLE_ID'
      },
      womens: {
        player: process.env.WOMENS_PLAYER_ROLE_ID || 'ROLE_ID',
        coach: process.env.WOMENS_COACH_ROLE_ID || 'ROLE_ID'
      }
    },
    channels: {
      events: process.env.EVENTS_CHANNEL_ID || '',
      logs: process.env.LOGS_CHANNEL_ID || '',
      ticket: process.env.TICKET_CHANNEL_ID || '',
      admin: process.env.ADMIN_LOGS_CHANNEL_ID || '',
      teamChats: {
        mens: process.env.MENS_TEAM_CHANNEL_ID || '',
        womens: process.env.WOMENS_TEAM_CHANNEL_ID || ''
      },
      staffRooms: {
        mens: process.env.MENS_STAFF_ROOM_ID || '',
        womens: process.env.WOMENS_STAFF_ROOM_ID || ''
      },
      privateChatCategories: {
        mens: process.env.MENS_PRIVATE_CHAT_CATEGORY_ID || '',
        womens: process.env.WOMENS_PRIVATE_CHAT_CATEGORY_ID || ''
      }
    },
    teams: {
      mens: {
        emoji: process.env.MENS_TEAM_EMOJI || '🔵',
        label: process.env.MENS_TEAM_LABEL || 'Mens',
        eventNamePhrases: ['Mens practice', 'FU Men']
      },
      womens: {
        emoji: process.env.WOMENS_TEAM_EMOJI || '🔴',
        label: process.env.WOMENS_TEAM_LABEL || 'Womens',
        eventNamePhrases: ['FU Women', "Women's practice"]
      }
    },
    googleSync: {
      enabled: (process.env.GOOGLE_SYNC_ENABLED || 'false').toLowerCase() === 'true',
      spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || '',
      commandLogRange: process.env.GOOGLE_COMMAND_LOG_RANGE || 'Command Log!A2:I',
      fixturesRange: process.env.GOOGLE_FIXTURES_RANGE || 'Fixtures!A2:F',
      mensFixturesRange: process.env.GOOGLE_MENS_FIXTURES_RANGE || 'Mens Fixtures!A2:F',
      womensFixturesRange: process.env.GOOGLE_WOMENS_FIXTURES_RANGE || 'Womens Fixtures!A2:F',
      attendanceRange: process.env.GOOGLE_ATTENDANCE_RANGE || 'Attendance!A2:F',
      configRange: process.env.GOOGLE_CONFIG_RANGE || 'Config!A2:C',
      configIdsRange: process.env.GOOGLE_CONFIG_IDS_RANGE || 'Config IDs!A2:C'
    }
  };
}

function ensureConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig(), null, 2));
    return;
  }

  const current = loadConfig();
  const base = defaultConfig();
  const currentRoles = current.roles || {};
  const currentTeams = current.teams || {};

  const mergedRoles = Object.fromEntries(
    [...new Set([...Object.keys(base.roles), ...Object.keys(currentRoles)])]
      .map((teamKey) => [
        teamKey,
        {
          player: base.roles?.[teamKey]?.player || 'ROLE_ID',
          coach: base.roles?.[teamKey]?.coach || 'ROLE_ID',
          ...(currentRoles[teamKey] || {})
        }
      ])
  );

  const mergedTeams = Object.fromEntries(
    [...new Set([...Object.keys(base.teams), ...Object.keys(currentTeams)])]
      .map((teamKey) => [
        teamKey,
        {
          emoji: base.teams?.[teamKey]?.emoji || '🔹',
          label: base.teams?.[teamKey]?.label || teamKey,
          eventNamePhrases: base.teams?.[teamKey]?.eventNamePhrases || [],
          ...(currentTeams[teamKey] || {})
        }
      ])
  );

  const merged = {
    ...defaultConfig(),
    ...current,
    bot: { ...base.bot, ...(current.bot || {}) },
    roles: mergedRoles,
    channels: {
      ...base.channels,
      ...(current.channels || {}),
      teamChats: {
        ...base.channels.teamChats,
        ...(current.channels?.teamChats || {})
      },
      staffRooms: {
        ...base.channels.staffRooms,
        ...(current.channels?.staffRooms || {})
      },
      privateChatCategories: {
        ...base.channels.privateChatCategories,
        ...(current.channels?.privateChatCategories || {})
      }
    },
    teams: mergedTeams,
    googleSync: {
      ...base.googleSync,
      ...(current.googleSync || {})
    }
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return defaultConfig();
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function updateConfig(pathKey, value) {
  const config = loadConfig();
  const keys = pathKey.split('.');

  let pointer = config;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (typeof pointer[key] !== 'object' || pointer[key] === null) pointer[key] = {};
    pointer = pointer[key];
  }

  pointer[keys[keys.length - 1]] = value;
  saveConfig(config);
  return config;
}

module.exports = {
  CONFIG_PATH,
  ensureConfig,
  loadConfig,
  saveConfig,
  updateConfig,
  defaultConfig
};
