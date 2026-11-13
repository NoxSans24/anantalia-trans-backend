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

    clear() {
      store.clear();
    },
  };
}
