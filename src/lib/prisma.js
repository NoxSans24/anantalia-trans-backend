import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';

function withUtcTimeZone(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    const existingOptions = parsed.searchParams.get('options') ?? '';
    if (!/\bTimeZone=/i.test(existingOptions)) {
      parsed.searchParams.set('options', existingOptions ? `${existingOptions} -c TimeZone=UTC` : '-c TimeZone=UTC');
    }
    return parsed.toString();
  } catch {
    return databaseUrl;
  }
}

export function createPrismaClient(databaseUrl) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required to initialize Prisma');
  const adapter = new PrismaPg({ connectionString: withUtcTimeZone(databaseUrl) });
  return new PrismaClient({ adapter });
}
