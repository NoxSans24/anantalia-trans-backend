import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

test('ActivityLog Prisma id default matches the applied SQL migration', async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8'),
    readFile(new URL('../../prisma/migrations/add_activity_log/migration.sql', import.meta.url), 'utf8'),
  ]);
  const activityLogModel = schema.match(/model ActivityLog \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(activityLogModel, /id\s+String\s+@id\s+@default\(dbgenerated\("gen_random_uuid\(\)"\)\)\s+@db\.Uuid/);
  assert.match(migration, /"id" UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/);
});

test('verified fleet migration defaults, columns, indexes, and constraints match Prisma models', async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8'),
    readFile(new URL('../../prisma/migrations/20261105120000_verified_fleet_catalog/migration.sql', import.meta.url), 'utf8'),
  ]);
  for (const model of ['VehicleCategory', 'VehicleModel', 'VehicleRentalOption']) {
    const definition = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
    assert.match(definition, /updatedAt\s+DateTime\s+@default\(now\(\)\)\s+@updatedAt/);
    assert.match(migration, new RegExp(`CREATE TABLE "${model}" \\(`));
    assert.match(migration, new RegExp(`"updatedAt" TIMESTAMPTZ\\(6\\) NOT NULL DEFAULT CURRENT_TIMESTAMP`));
  }
  assert.match(schema, /seatCount\s+Int\?/);
  assert.match(migration, /"VehicleModel_seatCount_check" CHECK \("seatCount" IS NULL OR "seatCount" BETWEEN 1 AND 200\)/);
  assert.match(migration, /"VehicleRentalOption_rentalType_check" CHECK \("rentalType" IN \('self_drive', 'with_driver'\)\)/);
  assert.match(migration, /"VehicleModel_categoryId_fkey" FOREIGN KEY \("categoryId"\) REFERENCES "VehicleCategory"\("id"\) ON DELETE RESTRICT/);
});

test('business modules persistence migration tables, columns, constraints, and indexes match Prisma models', async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8'),
    readFile(new URL('../../prisma/migrations/20261105210000_business_modules_persistence/migration.sql', import.meta.url), 'utf8'),
  ]);

  const models = [
    'Booking',
    'Customer',
    'PricingRule',
    'FinanceTransaction',
    'InboxMessage',
    'InboxMessageNote',
    'ContentItem',
    'SystemSetting',
  ];

  for (const model of models) {
    assert.match(schema, new RegExp(`model ${model} \\{`));
    assert.match(migration, new RegExp(`CREATE TABLE "${model}" \\(`));
  }

  assert.match(migration, /CREATE UNIQUE INDEX "Booking_bookingCode_key" ON "Booking"\("bookingCode"\)/);
  assert.match(migration, /"Booking_status_check" CHECK \("status" IN \('waiting_confirmation', 'under_verification', 'confirmed', 'rejected', 'cancelled', 'completed'\)\)/);
  assert.match(migration, /"Booking_dates_check" CHECK \("startsOn" <= "endsOn"\)/);
  assert.match(migration, /"Customer_name_check" CHECK \(btrim\("name"\) <> ''\)/);
  assert.match(migration, /"PricingRule_baseRate_check" CHECK \("baseRate" >= 0\)/);
  assert.match(migration, /"FinanceTransaction_type_check" CHECK \("type" IN \('income', 'expense'\)\)/);
  assert.match(migration, /"FinanceTransaction_amount_check" CHECK \("amount" > 0\)/);
  assert.match(migration, /"ContentItem_title_check" CHECK \(btrim\("title"\) <> ''\)/);
  assert.match(migration, /"InboxMessageNote_messageId_fkey" FOREIGN KEY \("messageId"\) REFERENCES "InboxMessage"\("id"\) ON DELETE CASCADE/);
});

test('all Prisma models and scalar columns exist across migration DDL files', async () => {
  const schema = await readFile(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
  const migrationsRoot = new URL('../../prisma/migrations/', import.meta.url);
  const entries = await readdir(migrationsRoot, { withFileTypes: true });
  const sqlChunks = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const sql = await readFile(new URL(`${entry.name}/migration.sql`, migrationsRoot), 'utf8');
      sqlChunks.push(sql);
    }
  }
  const combinedSql = sqlChunks.join('\n');

  const modelMatches = [...schema.matchAll(/model\s+(\w+)\s+\{([\s\S]*?)\n\}/g)];
  assert.equal(modelMatches.length, 25);

  const scalarTypes = new Set(['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'UserStatus']);
  for (const [, modelName, body] of modelMatches) {
    const createTableMatch = combinedSql.match(new RegExp(`CREATE TABLE "${modelName}" \\(([\\s\\S]*?)\\n\\);`));
    assert.ok(createTableMatch, `Missing CREATE TABLE for ${modelName}`);
    const tableSql = createTableMatch[1];

    const lines = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('//') && !line.startsWith('@@'));

    for (const line of lines) {
      const [fieldName, rawType] = line.split(/\s+/);
      const baseType = rawType?.replace(/[?[\]]/g, '');
      if (!scalarTypes.has(baseType)) continue;
      assert.match(
        tableSql,
        new RegExp(`"${fieldName}"\\s+`),
        `Model ${modelName} column "${fieldName}" missing in CREATE TABLE DDL`,
      );
    }
  }

  // Verify partial unique indexes and check constraints from earlier migrations remain intact
  assert.match(combinedSql, /CREATE UNIQUE INDEX "TotpFactor_one_pending_per_user_key"/);
  assert.match(combinedSql, /CREATE UNIQUE INDEX "TotpFactor_one_active_per_user_key"/);
  assert.doesNotMatch(combinedSql, /DROP INDEX.*"TotpFactor_one_pending_per_user_key"/i);
  assert.doesNotMatch(combinedSql, /DROP INDEX.*"TotpFactor_one_active_per_user_key"/i);
  assert.match(combinedSql, /"FinanceTransaction_type_check" CHECK \("type" IN \('income', 'expense', 'refund'\)\)/);
  assert.match(combinedSql, /"InboxMessage_status_check" CHECK \("status" IN \('unread', 'read', 'in_progress', 'waiting_customer', 'replied', 'resolved', 'archived', 'spam'\)\)/);
  assert.match(combinedSql, /"ContentItem_status_check" CHECK \("status" IN \('draft', 'scheduled', 'published', 'archived'\)\)/);
});
