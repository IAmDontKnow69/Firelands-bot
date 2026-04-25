const REQUIRED_TEAM_FIELDS = [
  { key: 'playerRole', label: 'Player Role' },
  { key: 'coachRole', label: 'Coach Role' },
  { key: 'teamChat', label: 'Team Chat' },
  { key: 'staffRoom', label: 'Staff Room' },
  { key: 'privateChatCategory', label: 'Private Chat Category' }
];

function getTeamRequirementValues(config, team) {
  return {
    playerRole: config.roles?.[team]?.player,
    coachRole: config.roles?.[team]?.coach,
    teamChat: config.channels?.teamChats?.[team],
    staffRoom: config.channels?.staffRooms?.[team],
    privateChatCategory: config.channels?.privateChatCategories?.[team]
  };
}

function isConfiguredId(value) {
  return !!value && value !== 'ROLE_ID';
}

function getMissingTeamSetupItems(config, team) {
  const values = getTeamRequirementValues(config, team);
  return REQUIRED_TEAM_FIELDS
    .filter((item) => !isConfiguredId(values[item.key]))
    .map((item) => item.label);
}

function getTeamSetupProgress(config, team) {
  const values = getTeamRequirementValues(config, team);
  const completed = REQUIRED_TEAM_FIELDS.filter((item) => isConfiguredId(values[item.key])).length;
  const total = REQUIRED_TEAM_FIELDS.length;
  return {
    completed,
    total,
    percent: Math.round((completed / total) * 100),
    isComplete: completed === total,
    missing: getMissingTeamSetupItems(config, team)
  };
}

function getMemberTeamsForMode(member, config, mode = 'player') {
  return Object.keys(config.teams || {}).filter((teamKey) => {
    const roleId = mode === 'coach' ? config.roles?.[teamKey]?.coach : config.roles?.[teamKey]?.player;
    return roleId && roleId !== 'ROLE_ID' && member?.roles?.cache?.has(roleId);
  });
}

function getIncompleteTeamsForMember(member, config, mode = 'player') {
  const teams = getMemberTeamsForMode(member, config, mode);
  return teams
    .map((team) => ({ team, ...getTeamSetupProgress(config, team) }))
    .filter((item) => !item.isComplete);
}

function buildIncompleteTeamMessage(config, incompleteTeams) {
  const lines = ['⚠️ Team setup is incomplete. Please finish required IDs before using this command:'];
  for (const teamInfo of incompleteTeams) {
    const label = config.teams?.[teamInfo.team]?.label || teamInfo.team;
    lines.push(`• **${label}** missing: ${teamInfo.missing.join(', ')}`);
  }
  return lines.join('\n');
}

module.exports = {
  REQUIRED_TEAM_FIELDS,
  getTeamRequirementValues,
  getMissingTeamSetupItems,
  getTeamSetupProgress,
  getMemberTeamsForMode,
  getIncompleteTeamsForMember,
  buildIncompleteTeamMessage
};
