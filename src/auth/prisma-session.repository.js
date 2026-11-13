export function createPrismaSessionRepository(prisma) {
  if (typeof prisma?.$transaction !== 'function'
    || typeof prisma?.$queryRaw !== 'function'
    || typeof prisma?.user?.findUnique !== 'function'
    || typeof prisma?.adminSession?.findUnique !== 'function'
    || typeof prisma?.adminSession?.create !== 'function'
    || typeof prisma?.adminSession?.updateMany !== 'function'
    || typeof prisma?.mfaCompletion?.updateMany !== 'function') {
    throw new TypeError('Prisma User and AdminSession models are required');
  }

  return Object.freeze({
    createSessionWithProof({ data, proofHash, purpose, now }) {
      return prisma.$transaction(async (tx) => {
        const consumed = await tx.mfaCompletion.updateMany({
          where: {
            proofHash,
            userId: data.userId,
            purpose,
            consumedAt: null,
            expiresAt: { gt: now },
            user: { is: { status: 'ACTIVE', deletedAt: null } },
          },
          data: { consumedAt: now },
        });
        if (consumed.count !== 1) return null;
        const eligible = await tx.$queryRaw`
          SELECT "id" FROM "User"
          WHERE "id" = ${data.userId}::uuid
            AND "status" = 'ACTIVE'::"UserStatus"
            AND "deletedAt" IS NULL
          FOR UPDATE
        `;
        if (eligible.length !== 1) throw new Error('Session account no longer eligible');
        return tx.adminSession.create({ data, select: { id: true, absoluteExpiresAt: true } });
      });
    },

    findUserForSession(userId) {
      return prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, status: true, deletedAt: true },
      });
    },

    findByTokenHash(tokenHash) {
      return prisma.adminSession.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          userId: true,
          tokenHash: true,
          createdAt: true,
          lastActivityAt: true,
          idleExpiresAt: true,
          absoluteExpiresAt: true,
          revokedAt: true,
          user: { select: { status: true, deletedAt: true } },
        },
      });
    },

    async touchSession({ sessionId, userId, tokenHash, now, idleExpiresAt }) {
      const rows = await prisma.$queryRaw`
        UPDATE "AdminSession" AS s
        SET "lastActivityAt" = ${now},
            "idleExpiresAt" = LEAST(${idleExpiresAt}, s."absoluteExpiresAt")
        FROM "User" AS u
        WHERE s."id" = ${sessionId}::uuid
          AND s."userId" = ${userId}::uuid
          AND s."tokenHash" = ${tokenHash}
          AND s."revokedAt" IS NULL
          AND s."idleExpiresAt" > ${now}
          AND s."absoluteExpiresAt" > ${now}
          AND u."id" = s."userId"
          AND u."status" = 'ACTIVE'::"UserStatus"
          AND u."deletedAt" IS NULL
        RETURNING s."id", s."userId", s."absoluteExpiresAt"
      `;
      return rows[0] ?? null;
    },

    async rotateSession({ sessionId, userId, oldTokenHash, newTokenHash, now, idleExpiresAt }) {
      const rows = await prisma.$queryRaw`
        UPDATE "AdminSession" AS s
        SET "tokenHash" = ${newTokenHash},
            "lastActivityAt" = ${now},
            "idleExpiresAt" = LEAST(${idleExpiresAt}, s."absoluteExpiresAt")
        FROM "User" AS u
        WHERE s."id" = ${sessionId}::uuid
          AND s."userId" = ${userId}::uuid
          AND s."tokenHash" = ${oldTokenHash}
          AND s."revokedAt" IS NULL
          AND s."idleExpiresAt" > ${now}
          AND s."absoluteExpiresAt" > ${now}
          AND u."id" = s."userId"
          AND u."status" = 'ACTIVE'::"UserStatus"
          AND u."deletedAt" IS NULL
        RETURNING s."id", s."userId", s."absoluteExpiresAt"
      `;
      return rows[0] ?? null;
    },

    revokeSession({ tokenHash, userId, now }) {
      return prisma.adminSession.updateMany({
        where: { tokenHash, userId, revokedAt: null },
        data: { revokedAt: now },
      });
    },

    revokeAllUserSessions({ userId, now, transactionClient = prisma }) {
      return transactionClient.adminSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
    },
  });
}
