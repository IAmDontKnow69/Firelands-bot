const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function defaultConfig() {
  return {
    _configBackups: [],
    bot: {
      tokenReference: process.env.DISCORD_TOKEN || '',
      clientId: process.env.DISCORD_CLIENT_ID || '',
      guildId: process.env.DISCORD_GUILD_ID || '',
      adminRoleId: process.env.ADMIN_ROLE_ID || '',
      playerCommandRoleId: process.env.PLAYER_COMMAND_ROLE_ID || '',
      coachCommandRoleId: process.env.COACH_COMMAND_ROLE_ID || '',
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
      botCommands: process.env.BOT_COMMANDS_CHANNEL_ID || '',
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
        gender: process.env.MENS_TEAM_GENDER || 'male',
        captainRoleId: process.env.MENS_CAPTAIN_ROLE_ID || '',
        captainEmoji: process.env.MENS_CAPTAIN_EMOJI || '🅒',
        eventNamePhrases: ['Mens practice', 'FU Men']
      },
      womens: {
        emoji: process.env.WOMENS_TEAM_EMOJI || '🔴',
        label: process.env.WOMENS_TEAM_LABEL || 'Womens',
        gender: process.env.WOMENS_TEAM_GENDER || 'female',
        captainRoleId: process.env.WOMENS_CAPTAIN_ROLE_ID || '',
        captainEmoji: process.env.WOMENS_CAPTAIN_EMOJI || '🅒',
        eventNamePhrases: ['FU Women', "Women's practice"]
      }
    },
    eventTypes: {
      autoDetect: true,
      practiceExactNames: ['Practice'],
      matchExactNames: [],
      otherExactNames: [],
      practiceKeywords: ['practice', 'training', 'session'],
      matchKeywords: ['match', 'game', 'fixture']
    },
    coachRoles: [
      { id: 'coach', label: 'Coach' }
    ],
    defaultCoachRoleId: 'coach',
    googleSync: {
      enabled: (process.env.GOOGLE_SYNC_ENABLED || 'false').toLowerCase() === 'true',
      spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || '',
      commandLogRange: process.env.GOOGLE_COMMAND_LOG_RANGE || 'Command Log!A2:I',
      fixturesRange: process.env.GOOGLE_FIXTURES_RANGE || 'Fixtures!A2:F',
      mensFixturesRange: process.env.GOOGLE_MENS_FIXTURES_RANGE || 'Mens Fixtures!A2:F',
      womensFixturesRange: process.env.GOOGLE_WOMENS_FIXTURES_RANGE || 'Womens Fixtures!A2:F',
      attendanceRange: process.env.GOOGLE_ATTENDANCE_RANGE || 'Attendance!A2:F',
      configRange: process.env.GOOGLE_CONFIG_RANGE || 'Config!A2:C',
      configIdsRange: process.env.GOOGLE_CONFIG_IDS_RANGE || 'Config IDs!A2:C',
      playersRange: process.env.GOOGLE_PLAYERS_RANGE || 'Player and Coach Management!A2:Q',
      teamFixturesRanges: {
        mens: process.env.GOOGLE_MENS_FIXTURES_RANGE || 'Mens Fixtures!A2:G',
        womens: process.env.GOOGLE_WOMENS_FIXTURES_RANGE || 'Womens Fixtures!A2:G'
      },
      autoFullSync: (process.env.GOOGLE_AUTO_FULL_SYNC || 'false').toLowerCase() === 'true'
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
          gender: base.teams?.[teamKey]?.gender || '',
          captainRoleId: base.teams?.[teamKey]?.captainRoleId || '',
          captainEmoji: base.teams?.[teamKey]?.captainEmoji || '🅒',
          eventNamePhrases: base.teams?.[teamKey]?.eventNamePhrases || [],
          ...(currentTeams[teamKey] || {})
        }
      ])
  );

  const merged = {
    ...defaultConfig(),
    ...current,
    _configBackups: Array.isArray(current._configBackups) ? current._configBackups.slice(0, 5) : [],
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
    eventTypes: {
      ...(base.eventTypes || {}),
      ...(current.eventTypes || {})
    },
    coachRoles: Array.isArray(current.coachRoles) && current.coachRoles.length ? current.coachRoles : base.coachRoles,
    defaultCoachRoleId: current.defaultCoachRoleId || base.defaultCoachRoleId,
    googleSync: {
      ...base.googleSync,
      ...(current.googleSync || {}),
      teamFixturesRanges: {
        ...(base.googleSync?.teamFixturesRanges || {}),
        ...(current.googleSync?.teamFixturesRanges || {})
      }
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

function cloneWithoutBackups(config = {}) {
  const cloned = JSON.parse(JSON.stringify(config || {}));
  delete cloned._configBackups;
  return cloned;
}

function pushConfigBackup(config = {}, meta = {}) {
  const existingBackups = Array.isArray(config._configBackups) ? config._configBackups : [];
  const snapshot = cloneWithoutBackups(config);
  const entry = {
    timestamp: new Date().toISOString(),
    changedPath: meta.changedPath || '',
    reason: meta.reason || 'update',
    snapshot: JSON.stringify(snapshot)
  };

  return [entry, ...existingBackups].slice(0, 5);
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

  const finalKey = keys[keys.length - 1];
  const currentValue = pointer?.[finalKey];
  const hasChanged = JSON.stringify(currentValue) !== JSON.stringify(value);
  if (hasChanged) {
    config._configBackups = pushConfigBackup(config, { changedPath: pathKey, reason: 'field_update' });
  }

  pointer[finalKey] = value;
  saveConfig(config);
  return config;
}

function restoreConfigFromBackup(index = 0) {
  const config = loadConfig();
  const backups = Array.isArray(config._configBackups) ? config._configBackups : [];
  const target = backups[index];
  if (!target?.snapshot) return null;

  let restored;
  try {
    restored = JSON.parse(target.snapshot);
  } catch {
    return null;
  }

  restored._configBackups = backups;
  saveConfig(restored);
  return restored;
}

function resetConfigFresh() {
  const current = loadConfig();
  const fresh = defaultConfig();
  const allTeams = new Set([
    ...Object.keys(current.teams || {}),
    ...Object.keys(current.roles || {}),
    ...Object.keys(current.channels?.teamChats || {}),
    ...Object.keys(current.channels?.staffRooms || {}),
    ...Object.keys(current.channels?.privateChatCategories || {})
  ]);

  fresh.teams = Object.fromEntries(
    [...allTeams].map((team) => [team, {
      emoji: '',
      label: '',
      gender: '',
      captainRoleId: '',
      captainEmoji: '',
      eventNamePhrases: []
    }])
  );
  fresh.roles = Object.fromEntries([...allTeams].map((team) => [team, { player: '', coach: '' }]));
  fresh.channels.teamChats = Object.fromEntries([...allTeams].map((team) => [team, '']));
  fresh.channels.staffRooms = Object.fromEntries([...allTeams].map((team) => [team, '']));
  fresh.channels.privateChatCategories = Object.fromEntries([...allTeams].map((team) => [team, '']));
  fresh.eventTypes = {
    autoDetect: false,
    practiceExactNames: [],
    matchExactNames: [],
    otherExactNames: [],
    practiceKeywords: [],
    matchKeywords: []
  };
  fresh._configBackups = pushConfigBackup(current, { reason: 'fresh_reset', changedPath: 'all' });

  saveConfig(fresh);
  return fresh;
}

module.exports = {
  CONFIG_PATH,
  ensureConfig,
  loadConfig,
  saveConfig,
  updateConfig,
  defaultConfig,
  restoreConfigFromBackup,
  resetConfigFresh
};
