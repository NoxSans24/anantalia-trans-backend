import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const USERNAME_PATTERN = /^[a-z0-9_-]{3,64}$/;

export function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

export function normalizeUsername(username) {
  if (typeof username !== 'string') return '';
  return username.trim().toLowerCase();
}

export async function bootstrapSuperAdmin({
  prisma,
  hashPassword,
  email,
  username,
  displayName = 'Super Admin',
  password,
  activityLog,
} = {}) {
  if (!prisma || typeof hashPassword !== 'function') {
    throw new TypeError('Prisma client and hashPassword function are required');
  }

  const normEmail = normalizeEmail(email);
  if (!EMAIL_PATTERN.test(normEmail)) {
    throw new Error('Valid email address is required');
  }

  const normUsername = normalizeUsername(username);
  if (!USERNAME_PATTERN.test(normUsername)) {
    throw new Error('Valid username is required (3-64 chars, alphanumeric, dash, underscore)');
  }

  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }

  const existingByEmail = await prisma.user.findUnique({
    where: { email: normEmail },
    include: { roles: { include: { role: true } } },
  });
  const existingByUsername = await prisma.user.findUnique({
    where: { username: normUsername },
    include: { roles: { include: { role: true } } },
  });

  const existing = existingByEmail ?? existingByUsername;
  if (existing) {
    const isSuperAdmin = existing.roles?.some((r) => r.role?.code === 'SUPER_ADMIN');
    if (isSuperAdmin) {
      return { status: 'ALREADY_EXISTS', userId: existing.id, email: existing.email, username: existing.username };
    }
    throw new Error('An account with this email or username already exists with different roles');
  }

  const passwordHash = await hashPassword(password);

  return prisma.$transaction(async (tx) => {
    let superAdminRole = await tx.role.findUnique({ where: { code: 'SUPER_ADMIN' } });
    if (!superAdminRole) {
      superAdminRole = await tx.role.create({ data: { code: 'SUPER_ADMIN' } });
    }

    const newUser = await tx.user.create({
      data: {
        email: normEmail,
        username: normUsername,
        displayName: typeof displayName === 'string' && displayName.trim() ? displayName.trim() : null,
        passwordHash,
        status: 'ACTIVE',
      },
    });

    await tx.userRole.create({
      data: {
        userId: newUser.id,
        roleId: superAdminRole.id,
      },
    });

    if (activityLog?.log) {
      await activityLog.log({
        actor: newUser.id,
        action: 'SUPER_ADMIN_BOOTSTRAPPED',
        resourceType: 'User',
        resourceId: newUser.id,
        targetUserId: newUser.id,
        client: tx,
      }).catch(() => {});
    }

    return {
      status: 'BOOTSTRAP_SUCCESS',
      userId: newUser.id,
      email: newUser.email,
      username: newUser.username,
    };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const isProd = process.env.NODE_ENV === 'production';
  const email = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || (!isProd ? 'admin@anantalia.local' : '');
  const username = process.env.BOOTSTRAP_SUPER_ADMIN_USERNAME || (!isProd ? 'superadmin' : '');
  const password = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD || (!isProd ? 'AdminAnantalia2026!' : '');
  const displayName = process.env.BOOTSTRAP_SUPER_ADMIN_NAME || 'Super Admin';

  if (!email || !username || !password) {
    process.stderr.write('Usage: BOOTSTRAP_SUPER_ADMIN_EMAIL, BOOTSTRAP_SUPER_ADMIN_USERNAME, and BOOTSTRAP_SUPER_ADMIN_PASSWORD environment variables are required.\n');
    process.exitCode = 1;
  } else {
    try {
      if (process.env.NODE_ENV === 'test') {
        const { checkTestDatabase } = await import('../connection-check.mjs');
        await checkTestDatabase();
      }
      process.env.ARGON2_MEMORY_COST ||= '65536';
      process.env.ARGON2_TIME_COST ||= '3';
      process.env.ARGON2_PARALLELISM ||= '4';
      process.env.ARGON2_HASH_LENGTH ||= '32';

      const { createHmac } = await import('node:crypto');
      const { createPrismaClient } = await import('../src/lib/prisma.js');
      const { hashPassword } = await import('../src/auth/password-service.js');
      const { createActivityLogService } = await import('../src/auth/activity-log-service.js');
      const { seedRolesAndPermissions } = await import('../src/lib/seed.js');
      const { createTotpKeyringProvider } = await import('../src/auth/totp-keyring-provider.js');
      const { createPrismaTotpFactorRepository } = await import('../src/auth/prisma-totp-factor.repository.js');
      const { createTotpFactorService } = await import('../src/auth/totp-factor-service.js');
      const { validateEnv } = await import('../src/config/env.js');

      const databaseUrl = process.env.NODE_ENV === 'test'
        ? (process.env.TEST_DATABASE_URL || process.env.DATABASE_URL)
        : validateEnv().databaseUrl;
      const prisma = createPrismaClient(databaseUrl);
      const activityLog = createActivityLogService({ prisma });

      await seedRolesAndPermissions(prisma);

      const result = await bootstrapSuperAdmin({
        prisma,
        hashPassword,
        email,
        username,
        displayName,
        password,
        activityLog,
      });

      if (result.status === 'ALREADY_EXISTS' && !isProd) {
        await prisma.user.update({
          where: { id: result.userId },
          data: { passwordHash: await hashPassword(password), status: 'ACTIVE', deletedAt: null },
        });
      }

      process.stdout.write(`Super Admin bootstrap result: ${result.status} (ID: ${result.userId})\n`);
      process.stdout.write(`Email   : ${result.email}\n`);
      process.stdout.write(`Username: ${result.username}\n`);

      const keyringProvider = createTotpKeyringProvider({
        loadKeyring: async () => {
          const activeKeyId = process.env.TOTP_ACTIVE_KEY_ID;
          const configuredKeys = JSON.parse(process.env.TOTP_KEYRING ?? 'null');
          if (!activeKeyId || !configuredKeys || typeof configuredKeys !== 'object' || Array.isArray(configuredKeys)) return null;
          const keys = Object.fromEntries(Object.entries(configuredKeys).map(([id, encoded]) => [id, Buffer.from(encoded, 'base64url')]));
          return { activeKeyId, keys };
        },
      });
      const encryption = await keyringProvider.load();
      if (encryption) {
        const totpService = createTotpFactorService({
          repository: createPrismaTotpFactorRepository(prisma),
          encryption,
        });
        await prisma.totpFactor.updateMany({
          where: { userId: result.userId, status: { in: ['PENDING', 'ACTIVE'] } },
          data: { status: 'REVOKED', revokedAt: new Date() },
        });
        const enrollment = await totpService.startEnrollment({
          userId: result.userId,
          accountName: result.email,
        });

        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        const decodeBase32 = (val) => {
          let bits = 0; let current = 0; const bytes = [];
          for (const ch of val) {
            current = (current << 5) | alphabet.indexOf(ch);
            bits += 5;
            if (bits >= 8) { bytes.push((current >>> (bits - 8)) & 255); bits -= 8; }
          }
          return Buffer.from(bytes);
        };
        const codeAt = (secret, step) => {
          const counter = Buffer.alloc(8);
          counter.writeBigUInt64BE(BigInt(step));
          const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
          const offset = digest.at(-1) & 15;
          const value = ((digest[offset] & 127) << 24)
            | ((digest[offset + 1] & 255) << 16)
            | ((digest[offset + 2] & 255) << 8)
            | (digest[offset + 3] & 255);
          return String(value % 1_000_000).padStart(6, '0');
        };

        const currentStep = BigInt(Math.floor(Date.now() / 30_000));
        await totpService.confirmEnrollment({
          userId: result.userId,
          factorId: enrollment.factorId,
          code: codeAt(enrollment.secret, currentStep - 1n),
        });

        process.stdout.write(`TOTP MFA Secret (Google Authenticator): ${enrollment.secret}\n`);
        process.stdout.write(`TOTP Provisioning URI                 : ${enrollment.otpauthUri}\n`);
        process.stdout.write(`Current 6-Digit MFA Code (now)        : ${codeAt(enrollment.secret, currentStep)}\n`);
        process.stdout.write(`Next 6-Digit MFA Code (+30s)          : ${codeAt(enrollment.secret, currentStep + 1n)}\n`);
      }

      await prisma.$disconnect();
    } catch (err) {
      process.stderr.write(`Bootstrap failed: ${err.message}\n`);
      process.exitCode = 1;
    }
  }
}
