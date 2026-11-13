# Anantalia Trans Backend

Backend layanan digital Anantalia Trans yang terintegrasi dengan **Admin Panel** dan **Public Website**.

## Tujuan dan status

Status saat ini: **OPERATIONAL (PERSISTENT PRISMA REPOSITORIES READY, DISPOSABLE DB EXECUTION GATED BY ENV)**.
Seluruh modul autentikasi, MFA TOTP (enrollment, confirmation, verification, revocation), bootstrap `SUPER_ADMIN`, katalog armada (`fleet`), dashboard, booking, customer, pricing, finance, inbox, content, analytics, dan system settings telah diimplementasikan menggunakan repository Prisma/PostgreSQL melalui dependency injection di `src/server.js`. Repository in-memory (`in-memory-*.repository.js`) dipertahankan khusus untuk isolated unit tests.

Backend dimiliki Tim Anantalia Trans. Maintainer: Muhammad Ihsan Hanafi.

## Technology stack terpilih

- Node.js 26.x
- JavaScript ES Modules
- Express 5.x
- npm
- PostgreSQL 18
- Prisma 7.x dan Prisma Migrate (`@prisma/adapter-pg`)

Pilihan teknologi tersebut telah disetujui. Versi dependency dipatok dalam `package.json` dan `package-lock.json`.

## Struktur repository saat ini

```text
src/                 Express app, auth, fleet, dashboard, booking, customer, pricing, finance, inbox, content, analytics, settings, Prisma repositories
prisma/              Prisma schema (22 models) and 10 SQL migrations
scripts/             Guarded test-migration runner (prisma-migrate-test.js) & SUPER_ADMIN bootstrap CLI (bootstrap-super-admin.js)
tests/unit/          Unit, HTTP route, API contract, and migration-consistency tests using injected dependencies
tests/integration/   PostgreSQL integration tests gated by explicit disposable DB configuration and SQL preflight
docs/api/            Synchronized OpenAPI 3.1 specification (openapi.yaml) for all mounted routes
docs/architecture/   Decision reconciliation and implementation readiness
```

Prisma Client output berada di `src/generated/prisma/` setelah generate dan diabaikan Git.

## API yang tersedia saat ini

- **Health**: `GET /health`
- **Auth & Session**: `GET /auth/csrf`, `POST /auth/login`, `POST /auth/mfa/verify`, `GET /auth/me`, `GET /auth/session`, `POST /auth/session/rotate`, `POST /auth/sessions/revoke-all`, `POST /auth/logout`
- **Admin Accounts & Profile**: `POST /api/admin/create`, `GET /api/admin/list`, `PATCH /api/admin/:id`, `DELETE /api/admin/:id`, `PUT /api/admin/:id/role`, `GET /api/me`, `PATCH /api/me`, `GET /api/me/mfa/status`, `POST /api/me/mfa/totp/enroll`, `POST /api/me/mfa/totp/confirm`, `POST /api/me/mfa/totp/revoke`
- **Public Fleet & Booking**:
  - `GET /api/v1/public/rental-types`
  - `GET /api/v1/public/vehicle-categories`
  - `GET /api/v1/public/vehicle-models`
  - `POST /api/v1/public/booking-requests`
- **Admin Fleet & Dashboard**:
  - `GET /api/v1/admin/dashboard/summary`
  - `/api/v1/admin/vehicle-categories*`, `/api/v1/admin/vehicle-models*`
- **Admin Business Modules (RBAC + CSRF protected)**:
  - **Booking**: `GET /api/v1/admin/bookings`, `GET /api/v1/admin/bookings/:id`, `PATCH /api/v1/admin/bookings/:id/status`
  - **Customer**: `GET /api/v1/admin/customers`, `POST /api/v1/admin/customers`, `GET /api/v1/admin/customers/:id`, `PATCH /api/v1/admin/customers/:id`, `DELETE /api/v1/admin/customers/:id`
  - **Pricing**: `GET /api/v1/admin/pricing`, `POST /api/v1/admin/pricing`, `GET /api/v1/admin/pricing/:id`, `PATCH /api/v1/admin/pricing/:id`, `DELETE /api/v1/admin/pricing/:id`
  - **Finance**: `GET /api/v1/admin/finance`, `GET /api/v1/admin/finance/summary`, `POST /api/v1/admin/finance`, `GET /api/v1/admin/finance/:id`
  - **Inbox**: `GET /api/v1/admin/messages`, `GET /api/v1/admin/messages/:id`, `PATCH /api/v1/admin/messages/:id/status`, `POST /api/v1/admin/messages/:id/notes`
  - **Content**: `GET /api/v1/admin/content`, `POST /api/v1/admin/content`, `GET /api/v1/admin/content/:id`, `PATCH /api/v1/admin/content/:id`, `DELETE /api/v1/admin/content/:id`
  - **Analytics**: `GET /api/v1/admin/analytics/overview`, `GET /api/v1/admin/analytics/export`
  - **System Settings**: `GET /api/v1/admin/settings`, `GET /api/v1/admin/settings/:key`, `PATCH /api/v1/admin/settings/:key`

Kontrak route lengkap terdokumentasi dan diuji otomatis terhadap [OpenAPI](docs/api/openapi.yaml).

## Variabel Environment (Tanpa Nilai Rahasia)

Salin `.env.example` menjadi `.env` (jangan pernah commit `.env`):

- `NODE_ENV`: `development` | `test` | `production`
- `HOST`: default `127.0.0.1`
- `PORT`: default `3000`
- `DATABASE_URL`: URL PostgreSQL aplikasi
- `CSRF_SECRET`: base64url dari 32 random bytes
- `TOTP_ACTIVE_KEY_ID`: ID key aktif pada `TOTP_KEYRING`
- `TOTP_KEYRING`: JSON object `{ "<key-id>": "<32-byte-base64url-key>" }`
- `ARGON2_MEMORY_COST`, `ARGON2_TIME_COST`, `ARGON2_PARALLELISM`: parameter hashing Argon2id
- Khusus pengujian database terisolasi (`NODE_ENV=test`):
  - `DATABASE_TEST_OPT_IN=I_CONFIRM_DISPOSABLE_DATABASE`
  - `TEST_DATABASE_NAME=anantalia_validation_test`
  - `TEST_DATABASE_ALLOWLIST=127.0.0.1:5432/anantalia_validation_test` (atau `127.0.0.1:5433/anantalia_validation_test` untuk container PostgreSQL 18 terisolasi)
  - `TEST_DATABASE_URL=postgresql://validation_user:<password>@127.0.0.1:5432/anantalia_validation_test?schema=public` (sesuaikan port `5432`/`5433` dengan `TEST_DATABASE_ALLOWLIST`)

## Menjalankan Ketiga Workspace Secara Lokal

### 1. Backend (`C:\Project Mandiri\anantalia-trans-backend`)
```powershell
npm.cmd ci
npm.cmd run prisma:generate
npm.cmd start
```
Untuk bootstrap akun `SUPER_ADMIN` pertama kali (hanya berhasil jika belum ada `SUPER_ADMIN` di database):
```powershell
node scripts/bootstrap-super-admin.js --email <email> --username <username> --password <password> --totp-secret <base32-secret>
```

### 2. Admin Panel (`C:\Project Mandiri\New folder\Dashboard Anatalia\stitch_anantalia_trans_admin_panel`)
```powershell
npm.cmd install
npm.cmd run dev
```
Untuk validasi dan build produksi:
```powershell
npm.cmd test
npm.cmd run validate
npm.cmd run build
```

### 3. Public Website (`C:\Project Mandiri\New folder\anatlia`)
```powershell
npm.cmd install
npm.cmd run build:css
npm.cmd run test:stabilization
```
Buka melalui static HTTP server lokal dan arahkan konfigurasi API ke backend (`http://127.0.0.1:3000`).

## Pengujian & Keamanan Database

- **Unit, HTTP, Contract & Migration Consistency Tests (tanpa koneksi DB)**:
  ```powershell
  npm.cmd test
  ```
- **Validasi Schema Prisma**:
  ```powershell
  npm.cmd run prisma:validate
  ```
- **Migrasi pada Disposable Test Database** (mewajibkan `TEST_DATABASE_URL` dan preflight SQL `SELECT current_database(), current_user, inet_server_addr(), inet_server_port()` — menerapkan 10 migrasi Prisma resmi):
  ```powershell
  npm.cmd run prisma:migrate:test
  ```
- **Database Integration Tests** (mewajibkan opt-in dan preflight SQL ke `anantalia_validation_test` port `5432` atau `5433` dengan role `validation_user`):
  ```powershell
  npm.cmd run test:db
  ```
- **Runner DB Sekali Pakai Terisolasi (Ephemeral Create -> Migrate -> Test -> Drop):**
  ```powershell
  npm.cmd run test:db:isolated
  ```

Lihat [Backend Foundation](docs/architecture/backend-foundation.md), [Decision Reconciliation](docs/architecture/decision-reconciliation.md), dan [Implementation Readiness](docs/architecture/implementation-readiness.md) untuk catatan keputusan bisnis yang masih ditangguhkan (seperti nomor WhatsApp tujuan `Q-WA-001` dan sumber telemetri GPS unit fisik).
