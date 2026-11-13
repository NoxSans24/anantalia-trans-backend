export function createPrismaTotpFactorRepository(prisma) {
  if (typeof prisma?.$transaction !== 'function'
    || typeof prisma?.$queryRaw !== 'function'
    || typeof prisma?.totpFactor?.create !== 'function'
    || typeof prisma?.totpFactor?.findFirst !== 'function'
    || typeof prisma?.totpFactor?.updateMany !== 'function') {
    throw new TypeError('Prisma TOTP factor model is required');
  }

  return Object.freeze({
    createPendingFactor(data) {
      return prisma.$transaction(async (tx) => {
        const eligible = await tx.$queryRaw`
          SELECT "id" FROM "User"
          WHERE "id" = ${data.userId}::uuid
            AND "status" = 'ACTIVE'::"UserStatus"
            AND "deletedAt" IS NULL
          FOR UPDATE
        `;
        if (eligible.length !== 1) return null;
        const existing = await tx.totpFactor.findFirst({
          where: { userId: data.userId, status: { in: ['PENDING', 'ACTIVE'] } },
          select: { id: true },
        });
        if (existing) return null;
        return tx.totpFactor.create({ data, select: { id: true, createdAt: true } });
      });
    },

    findFactor({ userId, factorId, status }) {
      return prisma.totpFactor.findFirst({
        where: {
          ...(factorId ? { id: factorId } : {}),
          userId,
          status,
          user: { is: { status: 'ACTIVE', deletedAt: null } },
        },
        select: {
          id: true,
          userId: true,
          status: true,
          encryptedSecret: true,
          secretNonce: true,
          secretAuthTag: true,
          encryptionKeyId: true,
        },
      });
    },

    async confirmPendingFactor({ userId, factorId, timeStep, now }) {
      const result = await prisma.totpFactor.updateMany({
        where: {
          id: factorId,
          userId,
          status: 'PENDING',
          user: { is: { status: 'ACTIVE', deletedAt: null } },
        },
        data: { status: 'ACTIVE', confirmedAt: now, lastAcceptedTimeStep: timeStep },
      });
      return result.count === 1;
    },

    async revokeFactor({ userId, factorId, now }) {
      const result = await prisma.totpFactor.updateMany({
        where: { id: factorId, userId, status: { in: ['PENDING', 'ACTIVE'] } },
        data: { status: 'REVOKED', revokedAt: now },
      });
      return result.count === 1;
    },

  });
}
