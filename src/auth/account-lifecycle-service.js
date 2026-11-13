const statuses = new Set(['ACTIVE', 'SUSPENDED', 'DISABLED']);
const missing = Object.freeze({ status: 'ACCOUNT_NOT_FOUND' });

function validUserId(userId) {
  return typeof userId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId);
}

export function createAccountLifecycleService({ prisma, userRepository, sessionRepository, activityLog, clock = () => new Date() } = {}) {
  if (typeof prisma?.$transaction !== 'function'
    || typeof userRepository?.findLifecycleState !== 'function'
    || typeof userRepository?.updateLifecycle !== 'function'
    || typeof userRepository?.lockAndCountActiveSuperAdmins !== 'function'
    || typeof sessionRepository?.revokeAllUserSessions !== 'function'
    || typeof clock !== 'function') {
    throw new TypeError('Account lifecycle dependencies are required');
  }

  async function apply(userId, { status, softDelete = false, actor, action } = {}) {
    if (!validUserId(userId) || (!softDelete && !statuses.has(status))) {
      return Object.freeze({ status: 'INVALID_ACCOUNT_LIFECYCLE_REQUEST' });
    }
    const now = clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Account lifecycle service unavailable');

    return prisma.$transaction(async (tx) => {
      const current = await userRepository.findLifecycleState(userId, tx);
      if (!current) return missing;
      if (current.deletedAt !== null && !softDelete) return missing;

      const deactivates = softDelete || status === 'SUSPENDED' || status === 'DISABLED';
      if (deactivates && current.status === 'ACTIVE' && current.deletedAt === null) {
        const superAdmins = await userRepository.lockAndCountActiveSuperAdmins(userId, tx);
        if (superAdmins?.targetIsSuperAdmin && superAdmins.activeSuperAdminCount <= 1) {
          return Object.freeze({ status: 'ACCOUNT_LIFECYCLE_DENIED' });
        }
      }

      const data = softDelete
        ? { deletedAt: current.deletedAt ?? now }
        : { status };
      if (current.deletedAt === null || !softDelete) {
        const changed = await userRepository.updateLifecycle({
          userId,
          expectedStatus: current.status,
          expectedDeletedAt: current.deletedAt,
          data,
          client: tx,
        });
        if (changed.count !== 1) throw new Error('Account lifecycle update conflict');
      }

      if (deactivates) {
        await sessionRepository.revokeAllUserSessions({ userId, now, transactionClient: tx });
      }
      if (activityLog && typeof actor === 'string' && typeof action === 'string') {
        await activityLog.log({ actor, action, resourceType: 'User', resourceId: userId, targetUserId: userId, client: tx });
      }
      return Object.freeze({ status: 'ACCOUNT_UPDATED' });
    });
  }

  return Object.freeze({
    setStatus(userId, status, audit) { return apply(userId, { status, ...audit }); },
    softDelete(userId, audit) { return apply(userId, { softDelete: true, ...audit }); },
  });
}
