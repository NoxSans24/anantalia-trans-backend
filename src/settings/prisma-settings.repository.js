export function createPrismaSettingsRepository(prisma) {
  if (!prisma) throw new TypeError('Prisma client is required');

  return Object.freeze({
    async getAll() {
      const rows = await prisma.systemSetting.findMany();
      return Object.fromEntries(rows.map((row) => [row.key, row.value]));
    },

    async get(key) {
      const row = await prisma.systemSetting.findUnique({ where: { key } });
      return row ? row.value : undefined;
    },

    async set(key, value) {
      const saved = await prisma.systemSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value, updatedAt: new Date() },
      });
      return saved.value;
    },

    async getSetting(key) {
      const row = await prisma.systemSetting.findUnique({ where: { key } });
      return row ? { key: row.key, value: row.value } : null;
    },

    async upsertSetting(key, value) {
      const saved = await prisma.systemSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value, updatedAt: new Date() },
      });
      return { key: saved.key, value: saved.value };
    },
  });
}
