export function createTotpKeyringProvider({ loadKeyring } = {}) {
  if (typeof loadKeyring !== 'function') throw new TypeError('A TOTP keyring provider is required');

  return Object.freeze({
    async load() {
      try {
        return await loadKeyring() ?? null;
      } catch {
        return null;
      }
    },
  });
}
