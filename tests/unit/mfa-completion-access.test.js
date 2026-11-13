import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function javascriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await javascriptFiles(fullPath));
    else if (entry.name.endsWith('.js')) files.push(fullPath);
  }
  return files;
}

test('MFA completion factory is private to package consumers and has no production caller', async () => {
  const publicApi = await import('../../src/auth/mfa-completion-service.js');
  assert.equal('createMfaCompletionService' in publicApi, false);
  assert.equal('issueAfterVerification' in publicApi, false);
  await assert.rejects(
    import('anantalia-trans-backend/src/auth/internal/mfa-completion-factory.js'),
    { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' },
  );

  const sourceFiles = await javascriptFiles(path.join(projectRoot, 'src'));
  const source = await Promise.all(sourceFiles.map(async (file) => [file, await readFile(file, 'utf8')]));
  const sourceText = source.map(([, contents]) => contents).join('\n');
  const factoryImports = source
    .filter(([, contents]) => contents.includes('mfa-completion-factory'))
    .map(([file]) => path.relative(projectRoot, file).replaceAll(path.sep, '/'));
  const testFixtureImports = source
    .filter(([, contents]) => contents.includes('mfa-completion-fixture'))
    .map(([file]) => path.relative(projectRoot, file).replaceAll(path.sep, '/'));

  assert.deepEqual(factoryImports.filter((file) => file !== 'src/server.js'), []);
  assert.deepEqual(testFixtureImports, []);
  assert.equal(sourceText.includes('factorVerifier'), false);
  assert.equal(sourceText.includes('createMfaCompletionService'), false);
});
