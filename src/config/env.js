import { isIP } from 'node:net';

const allowedEnvironments = new Set(['development', 'test', 'production']);
const trustedProxyKeywords = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isTrustedProxyEntry(entry) {
  if (trustedProxyKeywords.has(entry.toLowerCase())) return true;
  const parts = entry.split('/');
  if (parts.length > 2) return false;
  const family = isIP(parts[0]);
  if (family === 0) return false;
  if (parts.length === 1) return true;
  if (!/^\d+$/.test(parts[1])) return false;
  const prefix = Number(parts[1]);
  return family === 4 ? prefix <= 32 : prefix <= 128;
}

function parseTrustProxy(rawValue) {
  if (rawValue === undefined || String(rawValue).trim() === '') return 'loopback';
  const trimmed = String(rawValue).trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'true' || lower === '*') {
    throw new Error('TRUST_PROXY must not be true or *');
  }
  if (lower === 'false') return false;
  if (/^\d+$/.test(trimmed)) {
    const hops = Number(trimmed);
    if (hops > 10) {
      throw new Error('TRUST_PROXY hop count must be between 0 and 10');
    }
    return hops;
  }
  const entries = trimmed.split(',').map((item) => item.trim()).filter(Boolean);
  if (entries.length === 0 || entries.some((entry) => !isTrustedProxyEntry(entry))) {
    throw new Error('TRUST_PROXY must be false, a hop count (0-10), or trusted proxy addresses');
  }
  const normalized = entries.map((entry) => (trustedProxyKeywords.has(entry.toLowerCase()) ? entry.toLowerCase() : entry));
  return normalized.length === 1 ? normalized[0] : normalized;
}

export function validateEnv(input = process.env) {
  const environment = input.NODE_ENV ?? 'development';
  const host = input.HOST ?? '127.0.0.1';
  const port = Number(input.PORT ?? 3000);
  const databaseUrl = input.DATABASE_URL;
  const trustProxy = parseTrustProxy(input.TRUST_PROXY);

  if (!allowedEnvironments.has(environment)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) {
    throw new Error('DATABASE_URL must identify a PostgreSQL database');
  }

  return { environment, host, port, databaseUrl, trustProxy };
}
