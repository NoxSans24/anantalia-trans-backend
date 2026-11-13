import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const secretBytes = 20;
const timestepSeconds = 30;
const rejected = Object.freeze({ status: 'TOTP_FACTOR_REJECTED' });

function keyRing(config) {
  const entries = config?.keys instanceof Map ? [...config.keys] : Object.entries(config?.keys ?? {});
  const keys = new Map();
  for (const [id, key] of entries) {
    if (typeof id !== 'string' || id.length === 0 || !(key instanceof Uint8Array) || key.byteLength !== 32) {
      throw new TypeError('A valid TOTP encryption key ring is required');
    }
    keys.set(id, Buffer.from(key));
  }
  if (typeof config?.activeKeyId !== 'string' || !keys.has(config.activeKeyId)) {
    throw new TypeError('A valid active TOTP encryption key id is required');
  }
  return { activeKeyId: config.activeKeyId, keys };
}

function base32(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let encoded = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) encoded += alphabet[(value << (5 - bits)) & 31];
  return encoded;
}

function stepCode(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(step);
  const digest = createHmac('sha1', secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

function matchingStep(secret, code, now) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const current = BigInt(Math.floor(now.getTime() / 1000 / timestepSeconds));
  const supplied = Buffer.from(code, 'ascii');
  let matched = null;
  for (const step of [current - 1n, current, current + 1n]) {
    if (step < 0n) continue;
    if (timingSafeEqual(Buffer.from(stepCode(secret, step), 'ascii'), supplied)) matched = step;
  }
  return matched;
}

function encryptSecret(secret, { id, userId }, encryption) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryption.keys.get(encryption.activeKeyId), nonce);
  cipher.setAAD(Buffer.from(`anantalia:totp:v1:${userId}:${id}`));
  const encryptedSecret = Buffer.concat([cipher.update(secret), cipher.final()]);
  return {
    encryptedSecret,
    secretNonce: nonce,
    secretAuthTag: cipher.getAuthTag(),
    encryptionKeyId: encryption.activeKeyId,
  };
}

function decryptSecret(factor, encryption) {
  try {
    const key = encryption.keys.get(factor.encryptionKeyId);
    if (!key || factor.secretNonce?.byteLength !== 12 || factor.secretAuthTag?.byteLength !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, factor.secretNonce);
    decipher.setAAD(Buffer.from(`anantalia:totp:v1:${factor.userId}:${factor.id}`));
    decipher.setAuthTag(factor.secretAuthTag);
    const secret = Buffer.concat([decipher.update(factor.encryptedSecret), decipher.final()]);
    return secret.length === secretBytes ? secret : null;
  } catch {
    return null;
  }
}

function currentTime(clock) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('TOTP factor service unavailable');
  return new Date(value.getTime());
}

function validIdentity(value) {
  return typeof value === 'string' && value.length > 0;
}

export function createTotpFactorService({ repository, encryption, issuer = 'Anantalia Trans', clock = () => new Date() } = {}) {
  if (typeof repository?.createPendingFactor !== 'function'
    || typeof repository?.findFactor !== 'function'
    || typeof repository?.confirmPendingFactor !== 'function'
    || typeof repository?.revokeFactor !== 'function') {
    throw new TypeError('A complete TOTP factor repository is required');
  }
  if (typeof clock !== 'function') throw new TypeError('A TOTP factor clock is required');
  if (typeof issuer !== 'string' || issuer.length === 0) throw new TypeError('A TOTP issuer is required');
  const encryptionConfig = keyRing(encryption);

  async function startEnrollment({ userId, accountName } = {}) {
    if (!validIdentity(userId) || typeof accountName !== 'string' || accountName.length === 0 || accountName.length > 254 || /[\u0000-\u001f\u007f]/.test(accountName)) return rejected;
    const now = currentTime(clock);
    const id = randomUUID();
    const secret = randomBytes(secretBytes);
    const stored = encryptSecret(secret, { id, userId }, encryptionConfig);
    try {
      const factor = await repository.createPendingFactor({
        id, userId, status: 'PENDING', ...stored, createdAt: now,
      });
      if (!factor) return rejected;
      const encodedSecret = base32(secret);
      const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
      const query = new URLSearchParams({ secret: encodedSecret, issuer, algorithm: 'SHA1', digits: '6', period: String(timestepSeconds) });
      return {
        status: 'TOTP_ENROLLMENT_PENDING',
        factorId: id,
        secret: encodedSecret,
        provisioningUri: `otpauth://totp/${label}?${query}`,
      };
    } catch {
      throw new Error('TOTP factor service unavailable');
    }
  }

  async function confirmEnrollment({ userId, factorId, code } = {}) {
    if (!validIdentity(userId) || !validIdentity(factorId) || typeof code !== 'string' || !/^\d{6}$/.test(code)) return rejected;
    let factor;
    try {
      factor = await repository.findFactor({ userId, factorId, status: 'PENDING' });
    } catch {
      throw new Error('TOTP factor service unavailable');
    }
    if (!factor) return rejected;
    const secret = decryptSecret(factor, encryptionConfig);
    if (!secret) return rejected;
    const now = currentTime(clock);
    const timeStep = matchingStep(secret, code, now);
    if (timeStep === null) return rejected;
    try {
      const confirmed = await repository.confirmPendingFactor({ userId, factorId, timeStep, now });
      return confirmed ? { status: 'TOTP_ENROLLMENT_CONFIRMED' } : rejected;
    } catch {
      throw new Error('TOTP factor service unavailable');
    }
  }

  function verifyCode({ factor, code, now } = {}) {
    if (factor?.status !== 'ACTIVE'
      || typeof code !== 'string' || !/^\d{6}$/.test(code)
      || !(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
    const secret = decryptSecret(factor, encryptionConfig);
    return secret ? matchingStep(secret, code, now) : null;
  }

  async function revokeFactor({ userId, factorId } = {}) {
    if (!validIdentity(userId) || !validIdentity(factorId)) return rejected;
    try {
      const revoked = await repository.revokeFactor({ userId, factorId, now: currentTime(clock) });
      return revoked ? { status: 'TOTP_FACTOR_REVOKED' } : rejected;
    } catch {
      throw new Error('TOTP factor service unavailable');
    }
  }

  return Object.freeze({ startEnrollment, confirmEnrollment, verifyCode, revokeFactor });
}
