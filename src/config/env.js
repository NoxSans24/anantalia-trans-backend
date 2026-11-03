const allowedEnvironments = new Set(['development', 'test', 'production']);

export function validateEnv(input = process.env) {
  const environment = input.NODE_ENV ?? 'development';
  const host = input.HOST ?? '127.0.0.1';
  const port = Number(input.PORT ?? 3000);
  const databaseUrl = input.DATABASE_URL;

  if (!allowedEnvironments.has(environment)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) {
    throw new Error('DATABASE_URL must identify a PostgreSQL database');
  }

  return { environment, host, port, databaseUrl };
}
