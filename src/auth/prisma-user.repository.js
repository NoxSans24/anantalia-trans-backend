export function createPrismaUserRepository(prisma) {
  if (typeof prisma?.user?.findUnique !== 'function') {
    throw new TypeError('Prisma User model is required');
  }

  return Object.freeze({
    findForLocalLogin(identity) {
      if (!identity || !['email', 'username'].includes(identity.kind) || typeof identity.value !== 'string') {
        throw new TypeError('A canonical login identity is required');
      }
      const where = identity.kind === 'email' ? { email: identity.value } : { username: identity.value };
      return prisma.user.findUnique({
        where,
        select: { id: true, status: true, deletedAt: true, passwordHash: true },
      });
    },

    findLifecycleState(userId, client = prisma) {
      return client.user.findUnique({
        where: { id: userId },
        select: { id: true, status: true, deletedAt: true },
      });
    },

    updateLifecycle({ userId, expectedStatus, expectedDeletedAt, data, client = prisma }) {
      return client.user.updateMany({
        where: { id: userId, status: expectedStatus, deletedAt: expectedDeletedAt },
        data,
      });
    },

    async lockAndCountActiveSuperAdmins(userId, client = prisma) {
      await client.$queryRaw`SELECT "id" FROM "Role" WHERE "code" = 'SUPER_ADMIN' FOR UPDATE`;
      const [row] = await client.$queryRaw`
        SELECT
          EXISTS (
            SELECT 1 FROM "UserRole" ur
            JOIN "Role" r ON r."id" = ur."roleId"
            WHERE ur."userId" = ${userId}::uuid AND r."code" = 'SUPER_ADMIN'
          ) AS "targetIsSuperAdmin",
          count(*)::int AS "activeSuperAdminCount"
        FROM "User" u
        JOIN "UserRole" ur ON ur."userId" = u."id"
        JOIN "Role" r ON r."id" = ur."roleId"
        WHERE u."status" = 'ACTIVE'::"UserStatus"
          AND u."deletedAt" IS NULL
          AND r."code" = 'SUPER_ADMIN'
      `;
      return row;
    },
  });
}
