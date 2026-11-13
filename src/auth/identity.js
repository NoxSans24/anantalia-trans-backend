export function normalizeIdentity(value) {
  if (typeof value !== 'string') throw new TypeError('Identity must be a string');
  return value.trim().toLowerCase();
}

export function normalizeUserIdentifiers({ email, username }) {
  return {
    email: normalizeIdentity(email),
    username: normalizeIdentity(username),
  };
}
