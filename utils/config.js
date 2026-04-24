const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function defaultConfig() {
  return {
    bot: {
      tokenReference: process.env.DISCORD_TOKEN || '',
      clientId: process.env.DISCORD_CLIENT_ID || '',
      guildId: process.env.DISCORD_GUILD_ID || '',
      calendarId: process.env.CALENDAR_ID || 'hello@firelandsunited.com'
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
      teamChats: {
        mens: process.env.MENS_TEAM_CHANNEL_ID || '',
        womens: process.env.WOMENS_TEAM_CHANNEL_ID || ''
      }
    },
    teams: {
      mens: {
        emoji: process.env.MENS_TEAM_EMOJI || '🔵'
      },
      womens: {
        emoji: process.env.WOMENS_TEAM_EMOJI || '🔴'
      }
    }
  };
}

function ensureConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig(), null, 2));
    return;
  }

  const current = loadConfig();
  const merged = {
    ...defaultConfig(),
    ...current,
    bot: { ...defaultConfig().bot, ...(current.bot || {}) },
    roles: {
      mens: { ...defaultConfig().roles.mens, ...(current.roles?.mens || {}) },
      womens: { ...defaultConfig().roles.womens, ...(current.roles?.womens || {}) }
    },
    channels: {
      ...defaultConfig().channels,
      ...(current.channels || {}),
      teamChats: {
        ...defaultConfig().channels.teamChats,
        ...(current.channels?.teamChats || {})
      }
    },
    teams: {
      mens: { ...defaultConfig().teams.mens, ...(current.teams?.mens || {}) },
      womens: { ...defaultConfig().teams.womens, ...(current.teams?.womens || {}) }
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
