import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const schemaPath = path.join(root, 'prisma', 'schema.prisma');
const clientPath = path.join(root, 'src', 'generated', 'prisma', 'client.ts');
const modelsPath = path.join(root, 'src', 'generated', 'prisma', 'models.ts');

const hasGeneratedClient = existsSync(clientPath) && existsSync(modelsPath);
const isUpToDate =
  hasGeneratedClient &&
  existsSync(schemaPath) &&
  statSync(clientPath).mtimeMs >= statSync(schemaPath).mtimeMs;

if (isUpToDate) {
  process.exit(0);
}

const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const res = spawnSync(cmd, ['prisma', 'generate'], {
  cwd: root,
  stdio: 'pipe',
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

if (res.status === 0) {
  if (res.stdout) process.stdout.write(res.stdout);
  process.exit(0);
}

const combinedOutput = `${res.stdout || ''}\n${res.stderr || ''}`;
if (hasGeneratedClient && /EPERM|operation not permitted/i.test(combinedOutput)) {
  console.warn(
    'ensure-prisma-client: Prisma generate skipped due to Windows filesystem EPERM lock; existing generated client retained.',
  );
  process.exit(0);
}

if (res.stdout) process.stdout.write(res.stdout);
if (res.stderr) process.stderr.write(res.stderr);
process.exit(res.status ?? 1);
