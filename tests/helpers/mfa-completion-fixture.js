import { randomBytes } from 'node:crypto';
import { AUTHENTICATION_PURPOSE, hashProof } from '../../src/auth/mfa-completion-service.js';

export function createMfaCompletionFixture({ prisma, clock = () => new Date() } = {}) {
  return {
    async issueForUser(userId) {
      const proof = randomBytes(32).toString('base64url');
      const now = clock();
      await prisma.mfaCompletion.create({
        data: {
          userId,
          purpose: AUTHENTICATION_PURPOSE,
          proofHash: hashProof(proof),
          createdAt: now,
          expiresAt: new Date(now.getTime() + 300_000),
        },
      });
      return proof;
    },
  };
}
