import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const MIGRATION_NAME = '20261112220000_vehicle_unit_maintenance_booking_assignment';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_STATUSES = new Set(['available', 'in_use', 'maintenance', 'inactive']);

export async function applyUnitMigrationAndMigrateRegistry({ connectionString = process.env.DATABASE_URL } = {}) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const existing = await client.query(
      'SELECT "id" FROM "_prisma_migrations" WHERE "migration_name" = $1 AND "finished_at" IS NOT NULL',
      [MIGRATION_NAME],
    );
    if (existing.rows.length === 0) {
      const sql = readFileSync(resolve(process.cwd(), `prisma/migrations/${MIGRATION_NAME}/migration.sql`), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
           VALUES ($1, $2, now(), $3, 1)`,
          [randomUUID(), checksum, MIGRATION_NAME],
        );
        await client.query('COMMIT');
        console.log(`Applied migration: ${MIGRATION_NAME}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    } else {
      console.log(`Migration already applied: ${MIGRATION_NAME}`);
    }

    // Migrate legacy fleet_units_registry entries if any exist
    const regRes = await client.query('SELECT "value" FROM "SystemSetting" WHERE "key" = $1', ['fleet_units_registry']);
    let legacyUnits = [];
    if (regRes.rows.length > 0) {
      try {
        const parsed = JSON.parse(regRes.rows[0].value);
        if (Array.isArray(parsed)) legacyUnits = parsed;
      } catch {
        console.warn('Invalid JSON in fleet_units_registry; 0 units parsed');
      }
    }

    const summary = { sourceCount: legacyUnits.length, migrated: 0, skippedDuplicate: 0, invalidOrUnmapped: [] };
    if (legacyUnits.length > 0) {
      await client.query('BEGIN');
      try {
        for (const item of legacyUnits) {
          const plate = typeof item?.plateNumber === 'string' ? item.plateNumber.trim().toUpperCase().replace(/\s+/g, ' ') : '';
          const year = Number(item?.year);
          const status = VALID_STATUSES.has(item?.status) ? item.status : 'available';
          const nextServiceDate = typeof item?.nextServiceDate === 'string' && ISO_DATE.test(item.nextServiceDate) ? item.nextServiceDate : null;
          const lastServiceDate = typeof item?.lastServiceDate === 'string' && ISO_DATE.test(item.lastServiceDate) ? item.lastServiceDate : null;
          const modelId = typeof item?.modelId === 'string' ? item.modelId.trim() : '';

          if (!plate || plate.length < 3 || !Number.isSafeInteger(year) || year < 1990 || year > 2035 || !modelId) {
            summary.invalidOrUnmapped.push({ item, reason: 'INVALID_FIELDS' });
            continue;
          }

          const modelCheck = await client.query('SELECT "id" FROM "VehicleModel" WHERE "id"::text = $1 OR "slug" = $1 LIMIT 1', [modelId]);
          if (modelCheck.rows.length === 0) {
            summary.invalidOrUnmapped.push({ item, reason: 'MODEL_NOT_FOUND' });
            continue;
          }

          const dupCheck = await client.query('SELECT "id" FROM "VehicleUnit" WHERE "plateNumber" = $1', [plate]);
          if (dupCheck.rows.length > 0) {
            summary.skippedDuplicate += 1;
            continue;
          }

          const unitId = typeof item?.id === 'string' && /^[0-9a-f-]{36}$/i.test(item.id) ? item.id : randomUUID();
          await client.query(
            `INSERT INTO "VehicleUnit" ("id", "modelId", "plateNumber", "year", "status", "lastServiceDate", "nextServiceDate", "notes", "version", "isActive")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9)`,
            [unitId, modelCheck.rows[0].id, plate, year, status, lastServiceDate, nextServiceDate, item?.notes || null, status !== 'inactive'],
          );
          summary.migrated += 1;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('Migration summary:', JSON.stringify(summary));
    return summary;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url.toLowerCase() === `file:///${process.argv[1].replace(/\\/g, '/').toLowerCase()}`) {
  applyUnitMigrationAndMigrateRegistry().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
