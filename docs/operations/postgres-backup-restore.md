# PostgreSQL backup and restore

Use a PostgreSQL 18 `pg_dump` custom-format backup. Keep backup files outside the application image and protect them as production data. Store the PostgreSQL credential in the operator's secret store; do not pass it as a command argument or write it into this repository.

```sh
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="anantalia-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Restore into a separate, empty PostgreSQL database. Do not restore over the live database as a routine verification step.

```sh
pg_restore --exit-on-error --no-owner --no-privileges --dbname="$RESTORE_DATABASE_URL" anantalia-backup.dump
```

After restore, verify the target database identity, migration state, expected row counts, and application health before considering it usable. Retention duration, offsite location, encryption-at-rest, recovery owner, and RPO/RTO remain operational decisions; this repository does not assume them.

Host-local native `pg_dump.exe` / `pg_restore.exe` fail to start in this Windows environment (`-1073741515` / `0xC0000135`, loader status `3221225781`). However, containerized PostgreSQL 18 `pg_dump --format=custom --no-owner --no-privileges` and `pg_restore` have been verified against disposable `anantalia_validation_test` -> `anantalia_t7_restore_test` inside `anantalia-postgres18-validation` (`26` public tables, `10` applied migrations, and updated SQL `CHECK` constraints matched identically). For production operations, execute backups from a host/container with matching PostgreSQL 18 client binaries; off-host storage, retention, encryption, and recovery drills (RTO/RPO) still require owner/operator configuration (`PENDING_OWNER_CONFIRMATION`).
