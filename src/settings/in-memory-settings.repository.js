export function createInMemorySettingsRepository(initialData = {}) {
  const store = new Map(Object.entries(initialData));

  return {
    async getAll() {
      return Object.fromEntries(store.entries());
    },

    async get(key) {
      return store.get(key);
    },

    async set(key, value) {
      store.set(key, value);
      return value;
    },

    async getSetting(key) {
      return store.has(key) ? { key, value: store.get(key) } : null;
    },

    async upsertSetting(key, value) {
      store.set(key, value);
      return { key, value };
    },

    clear() {
      store.clear();
    },
  };
}
