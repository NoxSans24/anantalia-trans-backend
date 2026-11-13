export function createAuthorizationService({ prisma } = {}) {
  if (!prisma) throw new TypeError('Prisma client required');

  async function getUserPermissions(userId) {
    const roles = await prisma.userRole.findMany({
      where: { userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    const permissions = new Set();
    roles.forEach(ur => ur.role.permissions.forEach(rp => permissions.add(rp.permission.code)));
    return permissions;
  }

  async function hasPermission(userId, requiredPermission) {
    if (!userId || !requiredPermission) return false;
    const permissions = await getUserPermissions(userId);
    return permissions.has(requiredPermission);
  }

  async function requirePermission(userId, requiredPermission) {
    const allowed = await hasPermission(userId, requiredPermission);
    if (!allowed) {
      throw Object.freeze({ status: 'PERMISSION_DENIED', error: Object.freeze({ code: 'FORBIDDEN', message: 'Access denied' }) });
    }
  }

  async function canManageUser(actorId, targetUserId) {
    const actor = await prisma.user.findUnique({ where: { id: actorId }, include: { roles: { include: { role: true } } } });
    if (!actor) return false;
    const isSuperAdmin = actor.roles.some(ur => ur.role.code === 'SUPER_ADMIN');
    if (!isSuperAdmin) return false;
    if (actorId === targetUserId) return false; // can't modify self
    return true;
  }

  async function getLastActiveSuperAdmin() {
    return prisma.user.findFirst({
      where: { status: 'ACTIVE', deletedAt: null, roles: { some: { role: { code: 'SUPER_ADMIN' } } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async function canRevokeSuperAdmin(targetUserId) {
    const target = await prisma.user.findUnique({ where: { id: targetUserId }, include: { roles: { include: { role: true } } } });
    if (!target || target.roles.every(ur => ur.role.code !== 'SUPER_ADMIN')) return true; // not super admin
    if (target.status !== 'ACTIVE' || target.deletedAt !== null) return true; // already inactive
    const others = await prisma.user.count({
      where: {
        id: { not: targetUserId },
        status: 'ACTIVE',
        deletedAt: null,
        roles: { some: { role: { code: 'SUPER_ADMIN' } } },
      },
    });
    return others > 0; // only prevent if this is last active super admin
  }

  return Object.freeze({ getUserPermissions, hasPermission, requirePermission, canManageUser, getLastActiveSuperAdmin, canRevokeSuperAdmin });
}
