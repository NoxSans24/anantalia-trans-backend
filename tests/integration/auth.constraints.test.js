import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createTestPgClient } from './setup/database-setup.js';

const fixtureIds = { users: new Set(), roles: new Set(), permissions: new Set() };

async function insertUser(client, suffix = randomUUID()) {
  const id = randomUUID();
  const result = await client.query(
    'INSERT INTO "User" ("id", "email", "username", "status") VALUES ($1, $2, $3, \'ACTIVE\') RETURNING "id", "email", "username"',
    [id, `${suffix}@example.test`, `user-${suffix}`],
  );
  fixtureIds.users.add(id);
  return result.rows[0];
}

async function insertRole(client, code) {
  const id = randomUUID();
  await client.query('INSERT INTO "Role" ("id", "code") VALUES ($1, $2)', [id, code]);
  fixtureIds.roles.add(id);
  return id;
}

async function getSuperAdminRole(client) {
  const existing = await client.query('SELECT "id" FROM "Role" WHERE "code"=\'SUPER_ADMIN\'');
  if (existing.rows[0]) return existing.rows[0].id;
  const id = randomUUID();
  await client.query('INSERT INTO "Role" ("id", "code") VALUES ($1, \'SUPER_ADMIN\')', [id]);
  return id;
}

async function withClient(callback) {
  const client = await createTestPgClient();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function expectConstraint(promise, code, constraint) {
  const codes = Array.isArray(code) ? code : [code];
  await assert.rejects(promise, (error) => codes.includes(error.code) && error.constraint === constraint);
}

async function cleanupFixtures(client) {
  const userIds = [...fixtureIds.users];
  const roleIds = [...fixtureIds.roles];
  const permissionIds = [...fixtureIds.permissions];
  await client.query('DELETE FROM "RolePermission" WHERE "roleId" = ANY($1::uuid[]) OR "permissionId" = ANY($2::uuid[])', [roleIds, permissionIds]);
  await client.query('DELETE FROM "UserRole" WHERE "userId" = ANY($1::uuid[]) OR "roleId" = ANY($2::uuid[])', [userIds, roleIds]);
  if (userIds.length) {
    await client.query('DELETE FROM "ActivityLog" WHERE "actor" = ANY($1::uuid[]) OR "targetUserId" = ANY($1::uuid[])', [userIds]);
    await client.query('DELETE FROM "MfaCompletion" WHERE "userId" = ANY($1::uuid[])', [userIds]);
    await client.query('DELETE FROM "MfaChallenge" WHERE "userId" = ANY($1::uuid[])', [userIds]);
    await client.query('DELETE FROM "TotpFactor" WHERE "userId" = ANY($1::uuid[])', [userIds]);
    await client.query('DELETE FROM "OIDCIdentity" WHERE "userId" = ANY($1::uuid[])', [userIds]);
    await client.query('DELETE FROM "AdminSession" WHERE "userId" = ANY($1::uuid[])', [userIds]);
    await client.query('DELETE FROM "User" WHERE "id" = ANY($1::uuid[])', [userIds]);
  }
  if (roleIds.length) await client.query('DELETE FROM "Role" WHERE "id" = ANY($1::uuid[])', [roleIds]);
  if (permissionIds.length) await client.query('DELETE FROM "Permission" WHERE "id" = ANY($1::uuid[])', [permissionIds]);
}

test('database constraint checks run only against the explicitly authorized disposable database', async (t) => {
  try {
  await t.test('User identifiers normalize before uniqueness is enforced', async () => withClient(async (client) => {
    const suffix = randomUUID();
    const email = `${suffix}@example.test`;
    const username = `user-${suffix}`;
    const userId = randomUUID();
    const first = await client.query(
      'INSERT INTO "User" ("id", "email", "username", "status") VALUES ($1, $2, $3, \'ACTIVE\') RETURNING "email", "username"',
      [userId, `  ${email.toUpperCase()}  `, `  ${username.toUpperCase()}  `],
    );
    fixtureIds.users.add(userId);
    assert.deepEqual(first.rows[0], { email, username });
    await expectConstraint(client.query(
      'INSERT INTO "User" ("id", "email", "username", "status") VALUES ($1, $2, $3, \'ACTIVE\')',
      [randomUUID(), ` ${email.toUpperCase()} `, `different-${suffix}`],
    ), '23505', 'User_email_key');
    await expectConstraint(client.query(
      'INSERT INTO "User" ("id", "email", "username", "status") VALUES ($1, $2, $3, \'ACTIVE\')',
      [randomUUID(), `different-${suffix}@example.test`, ` ${username.toUpperCase()} `],
    ), '23505', 'User_username_key');
  }));

  await t.test('OIDC identity uniqueness is issuer plus subject and has no email-based link field', async () => withClient(async (client) => {
    const firstUser = await insertUser(client);
    const secondUser = await insertUser(client);
    const issuer = `https://issuer-${randomUUID()}.example.test`;
    const subject = randomUUID();
    const insertIdentity = (userId, identityIssuer, identitySubject) => client.query(
      'INSERT INTO "OIDCIdentity" ("id", "userId", "issuer", "subject") VALUES ($1, $2, $3, $4)',
      [randomUUID(), userId, identityIssuer, identitySubject],
    );

    await insertIdentity(firstUser.id, issuer, subject);
    await expectConstraint(insertIdentity(secondUser.id, issuer, subject), '23505', 'OIDCIdentity_issuer_subject_key');
    await insertIdentity(firstUser.id, issuer, `${subject}-different`);
    await insertIdentity(secondUser.id, `${issuer}/other`, subject);

    const columns = await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=\'public\' AND table_name=\'OIDCIdentity\'');
    assert.equal(columns.rows.some(({ column_name }) => column_name === 'email'), false);
    const owners = await client.query('SELECT "userId" FROM "OIDCIdentity" WHERE "issuer"=$1 AND "subject"=$2', [issuer, subject]);
    assert.equal(owners.rows[0].userId, firstUser.id);
  }));

  await t.test('role joins allow ordinary multi-role grants and reject duplicates or SUPER_ADMIN combinations', async () => withClient(async (client) => {
    const firstRole = await insertRole(client, `ROLE_A_${randomUUID()}`);
    const secondRole = await insertRole(client, `ROLE_B_${randomUUID()}`);
    const superRole = await getSuperAdminRole(client);
    const regularUser = await insertUser(client);
    const insertGrant = (userId, roleId) => client.query(
      'INSERT INTO "UserRole" ("userId", "roleId") VALUES ($1, $2)', [userId, roleId],
    );

    await insertGrant(regularUser.id, firstRole);
    await insertGrant(regularUser.id, secondRole);
    await expectConstraint(insertGrant(regularUser.id, firstRole), '23505', 'UserRole_pkey');

    const superFirstUser = await insertUser(client);
    await insertGrant(superFirstUser.id, superRole);
    await expectConstraint(insertGrant(superFirstUser.id, firstRole), '23514', 'UserRole_super_admin_exclusive');

    const regularFirstUser = await insertUser(client);
    await insertGrant(regularFirstUser.id, secondRole);
    await expectConstraint(insertGrant(regularFirstUser.id, superRole), '23514', 'UserRole_super_admin_exclusive');
  }));

  await t.test('Role.code is immutable while non-code updates remain allowed', async () => withClient(async (client) => {
    const unassignedCode = `IMMUTABLE_UNASSIGNED_${randomUUID()}`;
    const unassignedRole = await insertRole(client, unassignedCode);
    await expectConstraint(client.query('UPDATE "Role" SET "code"=$1 WHERE "id"=$2', [`CHANGED_${randomUUID()}`, unassignedRole]), '23514', 'Role_code_immutable');
    const unchanged = await client.query('SELECT "code" FROM "Role" WHERE "id"=$1', [unassignedRole]);
    assert.equal(unchanged.rows[0].code, unassignedCode);

    const assignedCode = `IMMUTABLE_ASSIGNED_${randomUUID()}`;
    const assignedRole = await insertRole(client, assignedCode);
    const user = await insertUser(client);
    await client.query('INSERT INTO "UserRole" ("userId", "roleId") VALUES ($1, $2)', [user.id, assignedRole]);
    await expectConstraint(client.query('UPDATE "Role" SET "code"=$1 WHERE "id"=$2', [`CHANGED_${randomUUID()}`, assignedRole]), '23514', 'Role_code_immutable');
    const intact = await client.query('SELECT r."code", count(ur."roleId")::int AS grants FROM "Role" r LEFT JOIN "UserRole" ur ON ur."roleId"=r."id" WHERE r."id"=$1 GROUP BY r."code"', [assignedRole]);
    assert.deepEqual(intact.rows[0], { code: assignedCode, grants: 1 });

    const changedRoleId = randomUUID();
    await client.query('UPDATE "Role" SET "id"=$1 WHERE "id"=$2', [changedRoleId, unassignedRole]);
    fixtureIds.roles.delete(unassignedRole);
    fixtureIds.roles.add(changedRoleId);
    const nonCodeUpdate = await client.query('SELECT "code" FROM "Role" WHERE "id"=$1', [changedRoleId]);
    assert.equal(nonCodeUpdate.rows[0].code, unassignedCode);
  }));

  await t.test('concurrent SUPER_ADMIN and ordinary grants serialize on the user row', async () => {
    const user = await withClient(insertUser);
    const superRole = await withClient(getSuperAdminRole);
    const ordinaryRole = await withClient((client) => insertRole(client, `CONCURRENT_${randomUUID()}`));
    const [first, second] = await Promise.all([createTestPgClient(), createTestPgClient()]);
    let secondTransactionOpen = false;
    let firstTransactionOpen = false;
    try {
      await first.query('BEGIN');
      firstTransactionOpen = true;
      await second.query('BEGIN');
      secondTransactionOpen = true;
      const secondPid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await first.query('INSERT INTO "UserRole" ("userId", "roleId") VALUES ($1, $2)', [user.id, superRole]);
      const competingInsert = second.query(
        'INSERT INTO "UserRole" ("userId", "roleId") VALUES ($1, $2)', [user.id, ordinaryRole],
      ).then(() => ({ ok: true }), (error) => ({ ok: false, error }));

      let isWaitingOnLock = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const waitState = await first.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [secondPid]);
        if (waitState.rows[0]?.wait_event_type === 'Lock') {
          isWaitingOnLock = true;
          break;
        }
        const settled = await Promise.race([competingInsert, new Promise((resolve) => setTimeout(() => resolve(null), 10))]);
        if (settled) break;
      }
      assert.equal(isWaitingOnLock, true, 'competing insert must wait on the same user row lock');
      await first.query('COMMIT');
      firstTransactionOpen = false;
      const result = await competingInsert;
      assert.equal(result.ok, false);
      assert.equal(result.error.code, '23514');
      assert.equal(result.error.constraint, 'UserRole_super_admin_exclusive');
      await second.query('ROLLBACK');
      secondTransactionOpen = false;
    } finally {
      if (firstTransactionOpen) await first.query('ROLLBACK').catch(() => {});
      if (secondTransactionOpen) await second.query('ROLLBACK').catch(() => {});
      await first.end();
      await second.end();
    }
  });

  await t.test('Role-Permission relations enforce foreign keys and do not cascade-delete entities', async () => withClient(async (client) => {
    const roleId = await insertRole(client, `PERM_ROLE_${randomUUID()}`);
    const permissionId = randomUUID();
    fixtureIds.permissions.add(permissionId);
    await client.query('INSERT INTO "Permission" ("id", "code") VALUES ($1, $2)', [permissionId, `PERM_${randomUUID()}`]);
    await client.query('INSERT INTO "RolePermission" ("roleId", "permissionId") VALUES ($1, $2)', [roleId, permissionId]);
    await expectConstraint(client.query('INSERT INTO "RolePermission" ("roleId", "permissionId") VALUES ($1, $2)', [roleId, permissionId]), '23505', 'RolePermission_pkey');
    await expectConstraint(client.query('DELETE FROM "Role" WHERE "id"=$1', [roleId]), ['23001', '23503'], 'RolePermission_roleId_fkey');

    await client.query('DELETE FROM "RolePermission" WHERE "roleId"=$1 AND "permissionId"=$2', [roleId, permissionId]);
    const surviving = await client.query('SELECT (SELECT count(*) FROM "Role" WHERE "id"=$1)::int AS roles, (SELECT count(*) FROM "Permission" WHERE "id"=$2)::int AS permissions', [roleId, permissionId]);
    assert.deepEqual(surviving.rows[0], { roles: 1, permissions: 1 });
  }));

  await t.test('session hash, revocation, and database time limits are enforced', async () => withClient(async (client) => {
    const user = await insertUser(client);
    const sessionId = randomUUID();
    const tokenHash = randomBytes(32);
    const insertSession = (id, hash, idleInterval = '30 minutes', absoluteInterval = '8 hours') => client.query(
      `INSERT INTO "AdminSession" ("id", "userId", "tokenHash", "idleExpiresAt", "absoluteExpiresAt") VALUES ($1, $2, $3, now() + interval '${idleInterval}', now() + interval '${absoluteInterval}')`,
      [id, user.id, hash],
    );

    await insertSession(sessionId, tokenHash);
    await expectConstraint(insertSession(randomUUID(), tokenHash), '23505', 'AdminSession_tokenHash_key');
    await expectConstraint(insertSession(randomUUID(), randomBytes(32), '31 minutes'), '23514', 'AdminSession_activity_expiry_check');
    await expectConstraint(insertSession(randomUUID(), randomBytes(32), '30 minutes', '8 hours 1 second'), '23514', 'AdminSession_absolute_expiry_check');

    await client.query('UPDATE "AdminSession" SET "revokedAt"=now() WHERE "id"=$1', [sessionId]);
    const active = await client.query('SELECT count(*)::int AS count FROM "AdminSession" WHERE "id"=$1 AND "revokedAt" IS NULL AND "idleExpiresAt" > now() AND "absoluteExpiresAt" > now()', [sessionId]);
    assert.equal(active.rows[0].count, 0);
  }));

  await t.test('soft-deleted users remain unique; active-account filtering is not a database behavior', async () => withClient(async (client) => {
    const user = await insertUser(client);
    await client.query('UPDATE "User" SET "deletedAt"=now() WHERE "id"=$1', [user.id]);
    const row = await client.query('SELECT "status", "deletedAt" IS NOT NULL AS deleted FROM "User" WHERE "id"=$1', [user.id]);
    assert.deepEqual(row.rows[0], { status: 'ACTIVE', deleted: true });

    await expectConstraint(client.query(
      'INSERT INTO "User" ("id", "email", "username", "status") VALUES ($1, $2, $3, \'ACTIVE\')',
      [randomUUID(), user.email, `new-${randomUUID()}`],
    ), '23505', 'User_email_key');
    await expectConstraint(client.query(
      'INSERT INTO "User" ("id", "email", "username", "status") VALUES ($1, $2, $3, \'ACTIVE\')',
      [randomUUID(), `${randomUUID()}@example.test`, user.username],
    ), '23505', 'User_username_key');
    const activeByExplicitPredicate = await client.query('SELECT count(*)::int AS count FROM "User" WHERE "id"=$1 AND "status"=\'ACTIVE\' AND "deletedAt" IS NULL', [user.id]);
    assert.equal(activeByExplicitPredicate.rows[0].count, 0);
  }));
  } finally {
    await withClient(cleanupFixtures);
  }
});
