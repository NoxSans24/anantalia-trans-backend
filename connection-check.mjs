import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAuthorizedTestDatabase, getTestServerIdentityMismatches } from './src/config/prisma-migration-safety.js';
import { createPrismaClient } from './src/lib/prisma.js';

export async function checkTestDatabase({ env = process.env, clientFactory = createPrismaClient } = {}) {
  const authorized = getAuthorizedTestDatabase(env);
  let prisma;
  try {
    prisma = clientFactory(authorized.connectionString);
    let rows;
    try {
      rows = await prisma.$queryRaw`
        SELECT current_database() AS database,
          current_user AS role,
          inet_server_addr()::text AS server_address,
          inet_server_port() AS server_port
      `;
    } catch (error) {
      const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'unknown';
      throw new Error(`Database preflight query failed (${code}); credentials and connection details are redacted`);
    }
    const [identity] = rows ?? [];
    const normalizedAddress = typeof identity?.server_address === 'string'
      ? identity.server_address.replace(/\/\d+$/, '')
      : identity?.server_address;
    const mismatches = getTestServerIdentityMismatches(identity, authorized);
    if (mismatches.length) throw new Error(`Database preflight identity mismatch: ${mismatches.join(', ')}`);
    return {
      database: identity.database,
      role: identity.role,
      server_address: normalizedAddress,
      server_port: Number(identity.server_port),
    };
  } finally {
    await prisma?.$disconnect().catch(() => {});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(await checkTestDatabase())}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
