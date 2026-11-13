export function createPrismaMfaChallengeRepository(prisma) {
  if (typeof prisma?.$transaction !== 'function'
    || typeof prisma?.$queryRaw !== 'function'
    || typeof prisma?.mfaChallenge?.create !== 'function') {
    throw new TypeError('Prisma MfaChallenge model is required');
  }

  return Object.freeze({
    createChallenge({ userId, challengeHash, purpose, createdAt, expiresAt }) {
      return prisma.$transaction(async (tx) => {
        const eligible = await tx.$queryRaw`
          SELECT "id" FROM "User"
          WHERE "id" = ${userId}::uuid
            AND "status" = 'ACTIVE'::"UserStatus"
            AND "deletedAt" IS NULL
          FOR UPDATE
        `;
        if (eligible.length !== 1) return null;
        return tx.mfaChallenge.create({
          data: { userId, challengeHash, purpose, createdAt, expiresAt },
          select: { expiresAt: true },
        });
      });
    },

    async consumeChallenge({ userId, challengeHash, purpose, now }) {
      const rows = await prisma.$queryRaw`
        UPDATE "MfaChallenge" AS c
        SET "consumedAt" = ${now}
        FROM "User" AS u
        WHERE c."challengeHash" = ${challengeHash}
          AND c."userId" = ${userId}::uuid
          AND c."purpose" = ${purpose}
          AND c."consumedAt" IS NULL
          AND c."expiresAt" > ${now}
          AND u."id" = c."userId"
          AND u."status" = 'ACTIVE'::"UserStatus"
          AND u."deletedAt" IS NULL
        RETURNING c."id"
      `;
      return rows.length === 1;
    },
  });
}
