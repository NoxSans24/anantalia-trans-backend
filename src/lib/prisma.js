import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';

export function createPrismaClient(databaseUrl) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required to initialize Prisma');
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}
