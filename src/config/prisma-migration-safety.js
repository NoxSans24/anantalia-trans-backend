import { isIP } from 'node:net';

const DEFAULT_DATABASE = 'anantalia_validation_test';
const APPROVED_DATABASE_PATTERN = /^anantalia_[a-z0-9_]+_test$/;
const BLOCKED_DATABASE_NAMES = new Set(['anantalia_backend_dev', 'anantalia_backend_prod', 'postgres', 'template0', 'template1']);
const REQUIRED_USER = 'validation_user';
const ALLOWED_TEST_PORTS = new Set(['5432', '5433']);
const OPT_IN = 'I_CONFIRM_DISPOSABLE_DATABASE';

function fail(reason) {
  throw new Error(`Prisma migration safety check failed: ${reason}. No database connection was attempted.`);
}

function parseUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { fail(`${label} is missing or invalid`); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash) fail(`${label} must be a PostgreSQL URL without a fragment`);
  return url;
}

function isApprovedTestDatabaseName(name) {
  return typeof name === 'string'
    && APPROVED_DATABASE_PATTERN.test(name)
    && !BLOCKED_DATABASE_NAMES.has(name);
}

function normalizeServerAddress(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\/\d+$/, '');
}

function isPrivateContainerIpv4(ip) {
  if (isIP(ip) !== 4) return false;
  const octets = ip.split('.').map(Number);
  if (octets[0] === 10) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  return false;
}

export function getTestServerIdentityMismatches(identity, config, { expectedDatabase = config.databaseName } = {}) {
  const actualDatabase = identity?.database ?? identity?.database_name;
  const actualRole = identity?.role ?? identity?.role_name;
  const normalizedAddress = normalizeServerAddress(identity?.server_address);
  const actualPort = Number(identity?.server_port);
  const allowedAddress = normalizedAddress === '127.0.0.1'
    || (config.host === '127.0.0.1' && isPrivateContainerIpv4(normalizedAddress));
  const allowedPorts = new Set([config.port, 5432]);

  return [
    actualDatabase !== expectedDatabase && 'database',
    actualRole !== config.username && 'role',
    !allowedAddress && 'server_address',
    (!Number.isInteger(actualPort) || !allowedPorts.has(actualPort)) && 'server_port',
  ].filter(Boolean);
}

export function getAuthorizedTestDatabase(env = process.env) {
  if (env.DATABASE_TEST_OPT_IN !== OPT_IN) fail('explicit test database opt-in is required');
  if (env.NODE_ENV !== 'test') fail('NODE_ENV must be test');
  if (!env.TEST_DATABASE_URL?.trim()) fail('TEST_DATABASE_URL is required');
  const databaseName = env.TEST_DATABASE_NAME?.trim();
  if (!isApprovedTestDatabaseName(databaseName)) {
    fail(`TEST_DATABASE_NAME must target an approved *_test database (such as ${DEFAULT_DATABASE})`);
  }

  const url = parseUrl(env.TEST_DATABASE_URL, 'TEST_DATABASE_URL');
  let username;
  try { username = decodeURIComponent(url.username); } catch { fail('TEST_DATABASE_URL username is invalid'); }
  if (url.hostname !== '127.0.0.1'
    || !ALLOWED_TEST_PORTS.has(url.port)
    || username !== REQUIRED_USER
    || url.pathname !== `/${databaseName}`
    || [...url.searchParams.keys()].some((key) => key !== 'schema')
    || (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public')) {
    fail('TEST_DATABASE_URL must target the approved local test database, role, port, and schema');
  }

  const target = `${url.hostname}:${url.port}/${databaseName}`;
  const allowlist = env.TEST_DATABASE_ALLOWLIST?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
  if (!allowlist.includes(target)) fail('the exact TEST_DATABASE_URL target is not in TEST_DATABASE_ALLOWLIST');

  if (env.DATABASE_URL) {
    const configuredUrl = parseUrl(env.DATABASE_URL, 'DATABASE_URL');
    const configuredDatabase = decodeURIComponent(configuredUrl.pathname.slice(1));
    const configuredPort = configuredUrl.port || '5432';
    const configuredLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(configuredUrl.hostname);
    if (configuredLoopback && configuredPort === url.port && configuredDatabase === databaseName) {
      fail('DATABASE_URL must not point to the authorized test target');
    }
  }

  return Object.freeze({
    connectionString: env.TEST_DATABASE_URL,
    databaseName,
    target,
    host: url.hostname,
    port: Number(url.port),
    username: REQUIRED_USER,
  });
}

const MUTATING_COMMANDS = new Set(['deploy', 'dev', 'reset', 'resolve']);

export function resolvePrismaDatasource({ argv = process.argv, env = process.env } = {}) {
  const args = argv.slice(2);
  const commandIndex = args.findIndex((arg) => arg === 'migrate' || arg === 'db');
  const command = args[commandIndex];
  const subcommand = args[commandIndex + 1];
  const mutatesSchema = (command === 'migrate' && MUTATING_COMMANDS.has(subcommand))
    || (command === 'db' && ['push', 'execute'].includes(subcommand));
  if (!mutatesSchema) return env.DATABASE_URL ? { url: env.DATABASE_URL } : {};

  if (env.NODE_ENV === 'test') return { url: getAuthorizedTestDatabase(env).connectionString };
  if (command === 'migrate' && subcommand === 'deploy' && env.NODE_ENV === 'production' && env.DATABASE_URL) {
    return { url: env.DATABASE_URL };
  }
  if (command === 'migrate' && subcommand === 'dev' && env.NODE_ENV === 'development' && env.DATABASE_URL) {
    return { url: env.DATABASE_URL };
  }
  fail('schema-changing Prisma commands require an authorized test target or explicit development/production mode');
}
