import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import { hashProof } from '../../src/auth/mfa-completion-service.js';

test('proof hashing accepts only canonical 256-bit base64url values', () => {
  const proof = randomBytes(32).toString('base64url');
  assert.deepEqual(hashProof(proof), createHash('sha256').update(Buffer.from(proof, 'base64url')).digest());
  for (const value of [undefined, '', true, 'not-a-proof', `${proof}=`, `${proof.slice(1)}`]) assert.equal(hashProof(value), null);
});
