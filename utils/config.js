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
      calendarId: process.env.CALENDAR_ID || '',
      calendarCredentialsPath: process.env.CALENDAR_CREDENTIALS_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS || ''
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
      commandLogRange: process.env.GOOGLE_COMMAND_LOG_RANGE || "'Command Logs'!A2:I",
      fixturesRange: process.env.GOOGLE_FIXTURES_RANGE || 'Fixtures!A2:F',
      attendanceRange: process.env.GOOGLE_ATTENDANCE_RANGE || 'Attendance!A2:F',
      configRange: process.env.GOOGLE_CONFIG_RANGE || 'Config!A2:C',
      configIdsRange: process.env.GOOGLE_CONFIG_IDS_RANGE || 'Config!A2:C',
      playersRange: process.env.GOOGLE_PLAYERS_RANGE || 'Player and Coach Management!A2:Q',
      teamFixturesRanges: {},
      autoFullSync: (process.env.GOOGLE_AUTO_FULL_SYNC || 'false').toLowerCase() === 'true'
    }
  };
}

function ensureConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({}, null, 2));
  }
}

function loadRawConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function buildRuntimeConfig(current = {}) {
  const base = defaultConfig();
  const currentRoles = current.roles || {};
  const currentTeams = current.teams || {};
  const baseRoles = base.roles || {};
  const baseTeams = base.teams || {};
  const baseChannels = base.channels || {};

  const mergedRoles = Object.fromEntries(
    [...new Set([...Object.keys(baseRoles), ...Object.keys(currentRoles)])]
      .map((teamKey) => [
        teamKey,
        {
          player: baseRoles?.[teamKey]?.player || 'ROLE_ID',
          coach: baseRoles?.[teamKey]?.coach || 'ROLE_ID',
          ...(currentRoles[teamKey] || {})
        }
      ])
  );

  const mergedTeams = Object.fromEntries(
    [...new Set([...Object.keys(baseTeams), ...Object.keys(currentTeams)])]
      .map((teamKey) => [
        teamKey,
        {
          emoji: baseTeams?.[teamKey]?.emoji || '🔹',
          label: baseTeams?.[teamKey]?.label || teamKey,
          gender: baseTeams?.[teamKey]?.gender || '',
          captainRoleId: baseTeams?.[teamKey]?.captainRoleId || '',
          captainEmoji: baseTeams?.[teamKey]?.captainEmoji || '🅒',
          viceCaptainEmoji: baseTeams?.[teamKey]?.viceCaptainEmoji || '🅥',
          eventNamePhrases: baseTeams?.[teamKey]?.eventNamePhrases || [],
          attendanceAutoSendDays: baseTeams?.[teamKey]?.attendanceAutoSendDays || 14,
          ...(currentTeams[teamKey] || {})
        }
      ])
  );

  const normalizedCurrentGoogleSync = { ...(current.googleSync || {}) };
  delete normalizedCurrentGoogleSync.mensFixturesRange;
  delete normalizedCurrentGoogleSync.womensFixturesRange;

  const merged = {
    ...defaultConfig(),
    ...current,
    _configBackups: Array.isArray(current._configBackups) ? current._configBackups.slice(0, 5) : [],
    bot: { ...base.bot, ...(current.bot || {}) },
    roles: mergedRoles,
    channels: {
      ...baseChannels,
      ...(current.channels || {}),
      teamChats: {
        ...(baseChannels.teamChats || {}),
        ...(current.channels?.teamChats || {})
      },
      staffRooms: {
        ...(baseChannels.staffRooms || {}),
        ...(current.channels?.staffRooms || {})
      },
      privateChatCategories: {
        ...(baseChannels.privateChatCategories || {}),
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
      ...normalizedCurrentGoogleSync,
      teamFixturesRanges: {
        ...(base.googleSync?.teamFixturesRanges || {}),
        ...(current.googleSync?.teamFixturesRanges || {})
      }
    }
  };

  return merged;
}

function loadConfig() {
  ensureConfig();
  return buildRuntimeConfig(loadRawConfig());
}

function saveConfig(config) {
  const safeConfig = config && typeof config === 'object' ? config : {};
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(safeConfig, null, 2));
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
  const config = loadRawConfig();
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
  const config = loadRawConfig();
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
  const current = loadRawConfig();
  const fresh = {
    _configBackups: pushConfigBackup(current, { reason: 'fresh_reset', changedPath: 'all' })
  };
  saveConfig(fresh);
  return loadConfig();
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
