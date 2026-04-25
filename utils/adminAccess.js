function getAdminRoleId(config = {}) {
  return (config.bot?.adminRoleId || '').trim();
}

function hasAdminAccess(member, config = {}) {
  const adminRoleId = getAdminRoleId(config);
  if (!adminRoleId) return !!member?.permissions?.has?.('Administrator');
  return !!member?.roles?.cache?.has(adminRoleId);
}

function adminAccessMessage(config = {}) {
  const adminRoleId = getAdminRoleId(config);
  if (!adminRoleId) {
    return 'Admin role is not configured yet. A server Administrator must set it first.';
  }
  return `Only members with <@&${adminRoleId}> can use admin commands.`;
}

module.exports = {
  getAdminRoleId,
  hasAdminAccess,
  adminAccessMessage
};
