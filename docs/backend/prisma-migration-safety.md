# Prisma migration safety

## Incident and cause

On 4 November 2026, a direct `npx prisma migrate deploy` ran while the PowerShell session lacked the test environment. Prisma loaded `.env`; `prisma.config.js` supplied only `DATABASE_URL`, so the migration targeted `anantalia_backend_dev` on the development endpoint. The `add_activity_log` migration completed there. The development migration history was inspected read-only afterward and was up to date; no rollback is part of this procedure.

## Configuration after the fix

`prisma.config.js` delegates datasource selection to `src/config/prisma-migration-safety.js`:

- `prisma generate` and `prisma validate` do not need a database connection.
- Schema-changing commands in `NODE_ENV=test` require the explicit opt-in, the fixed database name and role, loopback host, port 5432, and an exact allowlist entry. The selected datasource is always `TEST_DATABASE_URL`.
- `migrate deploy` is rejected in development. `migrate dev` continues to use the configured development `DATABASE_URL` only in development mode.
- Production `migrate deploy` keeps the existing `DATABASE_URL` behavior used by the Compose migration profile.
- Any absent, incomplete, or mismatched test setting stops Prisma config loading before Prisma can connect. Errors identify the missing or mismatched setting without printing URLs or credentials.

The integration-test database helper uses the same validator. It does not make `DATABASE_URL` a fallback. `npm run test:db` remains separate and does not automatically run migrations.

## Integration-test fixture lifecycle

`npm run test:db` runs integration-test files with `--test-concurrency=1` so database-backed files do not interleave shared fixtures. Each test tracks its own generated user IDs and removes dependent activity logs, MFA rows, factors, role assignments, identities, and sessions before deleting those users. Constraint-test roles and permissions created with unique fixture IDs are also removed by ID. The shared `SUPER_ADMIN` role and the role/permission catalog are reference data and are not removed by test cleanup.

`seedRolesAndPermissions()` upserts the known roles and permissions, then replaces all `RolePermission` mappings for those roles with the grants declared in `src/lib/seed.js`. The seed is not run automatically by `test:db`; the admin-account integration test invokes it explicitly. Because the mapping replacement is global for the known roles, keep that test serial and run it only against the authorized disposable database.

## Environments

| Environment | Prisma target behavior |
| --- | --- |
| Development | `migrate dev` can use `DATABASE_URL`; direct `migrate deploy` is blocked. |
| Testing | Schema-changing Prisma commands require the approved disposable target and use only `TEST_DATABASE_URL`. |
| Production | Existing deployment migration profile uses `DATABASE_URL` with `NODE_ENV=production`. |

## Run a testing migration safely

First provision and verify the disposable database and its restricted role through the approved local procedure. Put the credential in the current PowerShell session from an approved local secret store; do not put it in `.env`, source control, a script, or a command literal. Then set:

```powershell
$env:NODE_ENV = 'test'
$env:DATABASE_TEST_OPT_IN = 'I_CONFIRM_DISPOSABLE_DATABASE'
$env:TEST_DATABASE_NAME = 'anantalia_validation_test'
$env:TEST_DATABASE_ALLOWLIST = '127.0.0.1:5432/anantalia_validation_test'
# Set TEST_DATABASE_URL from the local secret store. It must identify validation_user at 127.0.0.1:5432/anantalia_validation_test.
npm run prisma:migrate:test
```

The script validates the target before starting the local Prisma CLI. Prisma config validates it again and selects `TEST_DATABASE_URL`. Neither path prints the connection string. This command applies pending migrations to the disposable database, so use it only after verifying its identity and authorization.

## Verify the target and fail-closed behavior

The URL must use PostgreSQL protocol, host `127.0.0.1`, explicit port `5432`, user `validation_user`, and database `anantalia_validation_test`; an optional query may contain only `schema=public`. `TEST_DATABASE_ALLOWLIST` must include the exact `host:port/database` target. `DATABASE_URL` may remain configured for the application, but is never used as a testing datasource. If any check fails, the test runner does not spawn Prisma and Prisma config throws before a schema-changing CLI command can connect.

Before a migration or database test, run `node connection-check.mjs` with the test variables set. It applies the same URL guard, executes a read-only identity query, and returns success only for `anantalia_validation_test` / `validation_user` / `127.0.0.1` / `5432`. The runtime PostgreSQL adapter uses node-postgres, which can resolve a password from the local pgpass file; do not assume Prisma CLI migrations use that mechanism. Provide the migration URL to the protected script from an approved local secret source, without placing it in source, `.env`, or command history.

Do not use direct `npx prisma migrate deploy` for testing. It bypasses the npm wrapper; Prisma config still enforces the guard in test mode and rejects the development default. Use `npm run prisma:migrate:test` so the wrapper also validates before launch. Production deployment remains through the established production Compose migration profile.

## Manual boundaries

This safeguard does not provision or delete databases, validate business approval for a migration, run migrations automatically with `test:db`, or prove that the supplied local credential belongs to a particular person. Operators must verify the PostgreSQL server identity and target before authorizing a migration. The package declares Node `>=26 <27`; the runtime used for this verification was Node 26.13.0.
