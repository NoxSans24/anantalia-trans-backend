import { randomBytes } from 'node:crypto';
import { hashProof } from './mfa-completion-service.js';

const rejected = Object.freeze({ status: 'MFA_VERIFICATION_REJECTED' });

export function createMfaVerificationService({ completionRepository } = {}) {
  if (typeof completionRepository?.verifyAndIssueCompletion !== 'function') {
    throw new TypeError('An MFA completion repository is required');
  }

  async function verify({ challenge, code } = {}) {
    if (typeof challenge !== 'string' || typeof code !== 'string') return rejected;
    const challengeHash = hashProof(challenge);
    if (!challengeHash) return rejected;
    const proof = randomBytes(32).toString('base64url');
    const proofHash = hashProof(proof);
    try {
      const completion = await completionRepository.verifyAndIssueCompletion({
        challengeHash,
        code,
        proofHash,
      });
      return completion
        ? { status: 'MFA_COMPLETION_CREATED', userId: completion.userId, proof, expiresAt: completion.expiresAt }
        : rejected;
    } catch {
      return rejected;
    }
  }

  return Object.freeze({ verify });
}
