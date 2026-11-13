import { normalizeIdentity } from './identity.js';

const allowedFields = new Set(['email', 'username', 'password']);

export function parseLoginInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalidInput();
  if (Object.keys(input).some((field) => !allowedFields.has(field))) return invalidInput();

  const hasEmail = Object.hasOwn(input, 'email');
  const hasUsername = Object.hasOwn(input, 'username');
  if (hasEmail === hasUsername) return invalidInput();

  const kind = hasEmail ? 'email' : 'username';
  if (typeof input[kind] !== 'string') return invalidInput();
  const value = normalizeIdentity(input[kind]);
  if (value.length === 0) return invalidInput();
  if (typeof input.password !== 'string' || input.password.length === 0) return invalidInput();

  return { ok: true, credentials: { identity: { kind, value }, password: input.password } };
}

function invalidInput() {
  return { ok: false, error: { code: 'INVALID_LOGIN_REQUEST', message: 'Invalid login request' } };
}
