const { upsertPlayerProfile, getPlayerProfile } = require('./database');

function getTeamRoleAssignment(config = {}, configPath = '') {
  const match = /^roles\.([^.]+)\.(player|coach)$/.exec(String(configPath || ''));
  if (!match) return null;

  const [, team, roleType] = match;
  const roleId = config.roles?.[team]?.[roleType];
  if (!roleId || roleId === 'ROLE_ID') return null;

  return { team, roleType, roleId };
}

async function syncProfilesForTeamRole(guild, config = {}, configPath = '') {
  const assignment = getTeamRoleAssignment(config, configPath);
  if (!assignment || !guild) return { scanned: false, count: 0, ...assignment };

  await guild.members.fetch().catch(() => null);

  const role = guild.roles.cache.get(assignment.roleId);
  if (!role) return { scanned: true, count: 0, ...assignment };

  const members = Array.from(role.members.values());
  for (const member of members) {
    const existing = getPlayerProfile(member.id) || {};
    const roles = Array.from(member.roles.cache.keys()).filter((id) => id !== guild.id);
    const payload = {
      userId: member.id,
      roles,
      joinedDiscordAt: existing.joinedDiscordAt || (member.joinedAt ? member.joinedAt.toISOString().slice(0, 10) : '')
    };

    if (assignment.roleType === 'player') {
      payload.teams = Array.from(new Set([...(existing.teams || []), assignment.team]));
    } else {
      payload.coachTeams = Array.from(new Set([...(existing.coachTeams || []), assignment.team]));
    }

    upsertPlayerProfile(member.id, payload);
  }

  return { scanned: true, count: members.length, ...assignment };
}

module.exports = {
  getTeamRoleAssignment,
  syncProfilesForTeamRole
};
