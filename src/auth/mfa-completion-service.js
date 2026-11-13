import { createHash } from 'node:crypto';

export const AUTHENTICATION_PURPOSE = 'AUTHENTICATION';

function hashProof(proof) {
  if (typeof proof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(proof)) return null;
  const bytes = Buffer.from(proof, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== proof) return null;
  return createHash('sha256').update(bytes).digest();
}

export { hashProof };
