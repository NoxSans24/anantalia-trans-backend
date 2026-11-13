export function createActivityLogService({ prisma } = {}) {
  if (!prisma) throw new TypeError('Prisma client required');

  async function log({ actor, action, resourceType, resourceId, targetUserId, details, ipAddress, userAgent, client = prisma }) {
    if (typeof actor !== 'string' || actor.length === 0) throw new Error('Actor required');
    if (typeof action !== 'string' || action.length === 0) throw new Error('Action required');
    try {
      return await client.activityLog.create({
        data: {
          actor,
          action,
          resourceType: resourceType || null,
          resourceId: resourceId || null,
          targetUserId: targetUserId || null,
          details: details || null,
          ipAddress: ipAddress || null,
          userAgent: userAgent || null,
        },
      });
    } catch {
      throw new Error('Activity log creation failed');
    }
  }

  async function getUserActivity(userId, limit = 50, offset = 0) {
    return prisma.activityLog.findMany({
      where: { OR: [{ actor: userId }, { targetUserId: userId }] },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async function getActivity(action, limit = 50, offset = 0) {
    return prisma.activityLog.findMany({
      where: { action },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  return Object.freeze({ log, getUserActivity, getActivity });
}
