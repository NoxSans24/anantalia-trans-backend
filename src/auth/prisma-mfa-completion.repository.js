import { AUTHENTICATION_PURPOSE } from './mfa-completion-service.js';

const challengeNotConsumed = new Error('Challenge was not consumed');
const proofLifetimeMs = 5 * 60 * 1000;

export function createPrismaMfaCompletionRepository(prisma, { verifyFactor } = {}) {
  if (typeof prisma?.$transaction !== 'function'
    || typeof prisma?.$queryRaw !== 'function'
    || typeof prisma?.mfaChallenge?.findUnique !== 'function'
    || typeof prisma?.mfaChallenge?.updateMany !== 'function'
    || typeof prisma?.totpFactor?.findFirst !== 'function'
    || typeof prisma?.totpFactor?.updateMany !== 'function'
    || typeof prisma?.mfaCompletion?.create !== 'function') {
    throw new TypeError('Prisma MFA completion models are required');
  }

  return Object.freeze({
    async verifyAndIssueCompletion({ challengeHash, code, proofHash }) {
      if (!(challengeHash instanceof Uint8Array)
        || !(proofHash instanceof Uint8Array)
        || typeof code !== 'string'
        || typeof verifyFactor !== 'function') return null;
      try {
        return await prisma.$transaction(async (tx) => {
          const [time] = await tx.$queryRaw`SELECT CURRENT_TIMESTAMP AS "now"`;
          const now = time?.now;
          if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return null;

          const challenge = await tx.mfaChallenge.findUnique({
            where: { challengeHash },
            select: {
              userId: true,
              purpose: true,
              expiresAt: true,
              consumedAt: true,
              user: { select: { status: true, deletedAt: true } },
            },
          });
          if (!challenge
            || challenge.purpose !== AUTHENTICATION_PURPOSE
            || challenge.consumedAt !== null
            || !(challenge.expiresAt instanceof Date)
            || challenge.expiresAt <= now
            || challenge.user?.status !== 'ACTIVE'
            || challenge.user.deletedAt !== null) return null;

          const eligible = await tx.$queryRaw`
            SELECT "id" FROM "User"
            WHERE "id" = ${challenge.userId}::uuid
              AND "status" = 'ACTIVE'::"UserStatus"
              AND "deletedAt" IS NULL
            FOR UPDATE
          `;
          if (eligible.length !== 1) return null;

          const factor = await tx.totpFactor.findFirst({
            where: {
              userId: challenge.userId,
              status: 'ACTIVE',
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
              lastAcceptedTimeStep: true,
            },
          });
          if (!factor || factor.status !== 'ACTIVE') return null;

          const timeStep = await verifyFactor({ factor, code, now });
          if (typeof timeStep !== 'bigint' || timeStep < 0n) return null;

          const accepted = await tx.totpFactor.updateMany({
            where: {
              id: factor.id,
              userId: challenge.userId,
              status: 'ACTIVE',
              user: { is: { status: 'ACTIVE', deletedAt: null } },
              OR: [{ lastAcceptedTimeStep: null }, { lastAcceptedTimeStep: { lt: timeStep } }],
            },
            data: { lastAcceptedTimeStep: timeStep },
          });
          if (accepted.count !== 1) return null;

          const consumed = await tx.mfaChallenge.updateMany({
            where: {
              challengeHash,
              userId: challenge.userId,
              purpose: AUTHENTICATION_PURPOSE,
              consumedAt: null,
              expiresAt: { gt: now },
              user: { is: { status: 'ACTIVE', deletedAt: null } },
            },
            data: { consumedAt: now },
          });
          if (consumed.count !== 1) throw challengeNotConsumed;

          const expiresAt = new Date(now.getTime() + proofLifetimeMs);
          await tx.mfaCompletion.create({
            data: {
              userId: challenge.userId,
              purpose: AUTHENTICATION_PURPOSE,
              proofHash,
              createdAt: now,
              expiresAt,
            },
            select: { id: true },
          });
          return { userId: challenge.userId, expiresAt };
        });
      } catch (error) {
        if (error === challengeNotConsumed) return null;
        throw error;
      }
    },
  });
}
