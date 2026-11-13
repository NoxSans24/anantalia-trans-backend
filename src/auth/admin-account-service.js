const manageableRoles = new Set(['ADMIN', 'STAFF']);

function rejected(status) {
  return Object.freeze({ status });
}

export function createAdminAccountService({ prisma, authService, activityLog, accountLifecycleService } = {}) {
  if (!prisma || !authService || !activityLog || !accountLifecycleService) throw new TypeError('All admin account dependencies are required');

  function validRoles(roles) {
    return Array.isArray(roles) && roles.length > 0
      && roles.every((role) => typeof role === 'string' && manageableRoles.has(role))
      && new Set(roles).size === roles.length;
  }

  function manageableAccount(user) {
    return user.roles.length > 0 && user.roles.every(({ role }) => manageableRoles.has(role.code));
  }

  async function requireManager(actor, permission, targetUserId = null) {
    await authService.requirePermission(actor, permission);
    if (!await authService.canManageUser(actor, targetUserId)) throw rejected('PERMISSION_DENIED');
  }

  async function createAdmin({ actor, email, username, displayName, roles }) {
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const normalizedUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) throw rejected('INVALID_ACCOUNT');
    if (normalizedUsername.length < 3 || normalizedUsername.length > 64) throw rejected('INVALID_ACCOUNT');
    if (!validRoles(roles)) throw rejected('INVALID_ROLE');
    await requireManager(actor, 'USER_CREATE');

    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.user.findFirst({ where: { OR: [{ email: normalizedEmail }, { username: normalizedUsername }] }, select: { id: true } });
        if (existing) throw rejected('ACCOUNT_CONFLICT');
        const roleRows = await tx.role.findMany({ where: { code: { in: roles } }, select: { id: true } });
        if (roleRows.length !== roles.length) throw rejected('INVALID_ROLE');
        const user = await tx.user.create({
          data: {
            email: normalizedEmail,
            username: normalizedUsername,
            displayName: typeof displayName === 'string' && displayName.trim() ? displayName.trim() : null,
            status: 'ACTIVE',
          },
          select: { id: true, email: true, username: true },
        });
        await tx.userRole.createMany({ data: roleRows.map(({ id: roleId }) => ({ userId: user.id, roleId })) });
        await activityLog.log({ actor, action: 'USER_CREATED', resourceType: 'User', resourceId: user.id, targetUserId: user.id, details: { roles }, client: tx });
        return { ...user, roles: roles.map((code) => ({ role: { code } })) };
      });
    } catch (error) {
      if (error?.code === 'P2002') throw rejected('ACCOUNT_CONFLICT');
      throw error;
    }
  }

  async function updateAdminRole({ actor, targetUserId, newRoles }) {
    if (!validRoles(newRoles)) throw rejected('INVALID_ROLE');
    await requireManager(actor, 'USER_UPDATE_ROLE', targetUserId);
    return prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: targetUserId }, include: { roles: { include: { role: true } } } });
      if (!target || target.deletedAt !== null) throw rejected('ACCOUNT_NOT_FOUND');
      if (!manageableAccount(target)) throw rejected('ACCOUNT_NOT_MANAGEABLE');
      const roleRows = await tx.role.findMany({ where: { code: { in: newRoles } }, select: { id: true } });
      if (roleRows.length !== newRoles.length) throw rejected('INVALID_ROLE');
      const oldRoles = target.roles.map(({ role }) => role.code);
      await tx.userRole.deleteMany({ where: { userId: targetUserId } });
      await tx.userRole.createMany({ data: roleRows.map(({ id: roleId }) => ({ userId: targetUserId, roleId })) });
      await activityLog.log({ actor, action: 'USER_ROLE_CHANGED', resourceType: 'User', resourceId: targetUserId, targetUserId, details: { oldRoles, newRoles }, client: tx });
      return tx.user.findUnique({ where: { id: targetUserId }, include: { roles: { include: { role: true } } } });
    });
  }

  async function transition({ actor, targetUserId, permission, status, softDelete = false, action }) {
    await authService.requirePermission(actor, permission);
    if (!await authService.canManageUser(actor, targetUserId)) throw rejected('PERMISSION_DENIED');
    const target = await prisma.user.findUnique({ where: { id: targetUserId }, include: { roles: { include: { role: true } } } });
    if (!target || target.deletedAt !== null) throw rejected('ACCOUNT_NOT_FOUND');
    if (!manageableAccount(target)) throw rejected('ACCOUNT_NOT_MANAGEABLE');
    const result = softDelete
      ? await accountLifecycleService.softDelete(targetUserId, { actor, action })
      : await accountLifecycleService.setStatus(targetUserId, status, { actor, action });
    if (result.status === 'ACCOUNT_LIFECYCLE_DENIED') throw rejected('LAST_SUPER_ADMIN_PROTECTED');
    if (result.status !== 'ACCOUNT_UPDATED') throw rejected('ACCOUNT_NOT_FOUND');
    return prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, status: true, deletedAt: true } });
  }

  async function suspendAdmin({ actor, targetUserId }) {
    return transition({ actor, targetUserId, permission: 'USER_UPDATE_STATUS', status: 'SUSPENDED', action: 'USER_SUSPENDED' });
  }

  async function disableAdmin({ actor, targetUserId }) {
    return transition({ actor, targetUserId, permission: 'USER_UPDATE_STATUS', status: 'DISABLED', action: 'USER_DISABLED' });
  }

  async function reactivateAdmin({ actor, targetUserId }) {
    return transition({ actor, targetUserId, permission: 'USER_UPDATE_STATUS', status: 'ACTIVE', action: 'USER_REACTIVATED' });
  }

  async function softDeleteAdmin({ actor, targetUserId }) {
    return transition({ actor, targetUserId, permission: 'USER_DELETE', softDelete: true, action: 'USER_SOFT_DELETED' });
  }

  async function getAdminProfile(userId) {
    const target = await prisma.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: true } } } });
    return target?.deletedAt === null && manageableAccount(target) ? target : null;
  }

  async function listAdmins(limit = 50, offset = 0) {
    return prisma.user.findMany({
      where: {
        deletedAt: null,
        roles: {
          some: { role: { code: { in: [...manageableRoles] } } },
          every: { role: { code: { in: [...manageableRoles] } } },
        },
      },
      include: { roles: { include: { role: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  return Object.freeze({ createAdmin, updateAdminRole, suspendAdmin, disableAdmin, reactivateAdmin, softDeleteAdmin, getAdminProfile, listAdmins });
}
