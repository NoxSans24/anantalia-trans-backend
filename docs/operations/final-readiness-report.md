# Final Operational Readiness & Blocker Resolution Report — Anantalia Trans

**Tanggal Laporan:** 6 November 2026  
**Workspaces:**
- **Backend:** `c:\Project Mandiri\anantalia-trans-backend`
- **Public Website:** `C:\Project Mandiri\New folder\anatlia`
- **Admin Panel:** `C:\Project Mandiri\New folder\Dashboard Anatalia\stitch_anantalia_trans_admin_panel`

---

## Ringkasan Eksekutif Berdasarkan 5 Kategori Status Wajib

### 1. IMPLEMENTED

1. **Backend Core, Auth, MFA/TOTP, RBAC & Session Security (`c:\Project Mandiri\anantalia-trans-backend`):**
   - Local login (`src/auth/local-login-service.js`), Argon2id password hashing/verification (`src/auth/password-service.js`), TOTP MFA AES-256-GCM keyring encryption & replay protection (`src/auth/totp-factor-service.js`), single-use hash-bound MFA challenge & completion proof (`src/auth/mfa-challenge-service.js`, `src/auth/prisma-mfa-completion.repository.js`), dan session lifecycle (`src/auth/session-service.js`, `src/auth/http-session-adapter.js`).
   - Session-bound HMAC-SHA256 CSRF protection (`src/middlewares/csrf.middleware.js`), rate limiting untuk login, verifikasi MFA, dan pembuatan booking publik (`src/middlewares/rate-limit.middleware.js`), serta sanitasi respons error `500` pada seluruh router bisnis.
   - Matriks RBAC `OWN-009` (`SUPER_ADMIN`, `ADMIN`, `STAFF`) dengan deny-by-default (`src/auth/authorization-service.js`, `src/lib/seed.js`) dan proteksi invariant database untuk `SUPER_ADMIN` aktif terakhir (`src/auth/account-lifecycle-service.js`).
2. **Prisma 7 Schema, 8 SQL Migrations & Persistent PostgreSQL Repositories:**
   - 22 model Prisma (`prisma/schema.prisma`) dan 8 migrasi SQL (`prisma/migrations/*/migration.sql`) mencakup seluruh domain: Auth, MFA/TOTP, RBAC, `ActivityLog`, `VehicleCategory`, `VehicleModel`, `VehicleRentalOption`, `Booking`, `Customer`, `PricingRule`, `FinanceTransaction`, `InboxMessage`, `InboxMessageNote`, `ContentItem`, dan `SystemSetting`.
   - Seluruh 10 modul bisnis (`fleet`, `dashboard`, `booking`, `customer`, `pricing`, `finance`, `inbox`, `content`, `analytics`, `settings`) menggunakan Prisma PostgreSQL repositories yang dipasang langsung pada `src/server.js`.
   - Normalisasi parameter koneksi `TimeZone=UTC` pada `src/lib/prisma.js` untuk mencegah pergeseran offset timezone pada serialisasi `Date` di `@prisma/adapter-pg`.
   - Validasi `Number.isSafeInteger` untuk nominal moneter (`baseRate` pada `src/pricing/pricing.service.js` dan `amount` pada `src/finance/finance.service.js`).
3. **Database Safety Guard & Migration Runner:**
   - `src/config/prisma-migration-safety.js`, `connection-check.mjs`, `scripts/prisma-migrate-test.js`, dan `tests/integration/setup/database-setup.js` menerapkan pemeriksaan berlapis: `NODE_ENV=test`, `DATABASE_TEST_OPT_IN=I_CONFIRM_DISPOSABLE_DATABASE`, pencocokan `TEST_DATABASE_NAME`, `TEST_DATABASE_ALLOWLIST`, dan preflight SQL (`current_database()`, `current_user`, `inet_server_addr()`, `inet_server_port()`) hanya ke `127.0.0.1:5432/anantalia_validation_test` (`validation_user`).
4. **Public Website (`C:\Project Mandiri\New folder\anatlia`) & Admin Panel (`C:\Project Mandiri\New folder\Dashboard Anatalia\stitch_anantalia_trans_admin_panel`):**
   - Public Website (5 halaman, Tailwind build statis tanpa CDN, katalog armada live dari `GET /api/v1/public/fleet-catalog`, modal detail & form booking terhubung ke `POST /api/v1/public/booking-requests` tanpa bergantung pada deep-link WhatsApp).
   - Admin Panel (10 halaman native tanpa iframe runtime, autentikasi cookie `HttpOnly` + header `X-CSRF-Token`, pengelolaan status booking, armada, pelanggan, tarif, keuangan, pesan masuk, konten, analitik, serta pengaturan sistem & akun).
5. **Dokumentasi Operasional & Readiness:**
   - `docs/operations/production-deployment-guide.md`
   - `docs/operations/owner-signoff-checklist.md`
   - `docs/operations/final-readiness-report.md`
   - Pembaruan `README.md`, `docs/api/openapi.yaml`, dan `docs/architecture/implementation-readiness.md`.

---

### 2. VERIFIED

1. **Diagnosis & Koneksi PostgreSQL Lokal (`127.0.0.1:5432/anantalia_validation_test`):**
   - Layanan Windows `postgresql-x64-16` (PostgreSQL `16.15` pada `C:\Program Files\PostgreSQL\16\bin`) berstatus `Running` dan menerima koneksi pada `127.0.0.1:5432`.
   - `node connection-check.mjs` -> **PASS (exit code 0)**:
     ```json
     {"database":"anantalia_validation_test","role":"validation_user","server_address":"127.0.0.1","server_port":5432}
     ```
   - Database development (`127.0.0.1:5433/anantalia_backend_dev`) dan produksi tidak disentuh. Tidak ada file `.env`, `pgpass.conf`, password, atau secret yang dibaca maupun ditampilkan.
2. **Migrasi PostgreSQL (`npm.cmd run prisma:migrate:test`):**
   - **PASS (exit code 0)** pada `127.0.0.1:5432/anantalia_validation_test`. Seluruh 8 migrasi diterapkan secara transaksional dan diverifikasi idempoten pada eksekusi ulang.
3. **Suite Pengujian Integrasi PostgreSQL (`npm.cmd run test:db`):**
   - **PASS (exit code 0) — 27/27 tests PASS (`fail 0`)** mencakup:
     - `tests/integration/account-lifecycle.test.js` (6 subtests)
     - `tests/integration/admin-account-management.test.js`
     - `tests/integration/auth.constraints.test.js` (8 subtests)
     - `tests/integration/authentication-orchestration.test.js`
     - `tests/integration/business-persistence.test.js`
     - `tests/integration/health.database.test.js` (2 subtests)
     - `tests/integration/http-auth.test.js`
     - `tests/integration/mfa-challenge.test.js`
     - `tests/integration/session.service.test.js`
     - `tests/integration/totp-factor.test.js`
4. **Suite Unit & Contract Tests Backend (`npm.cmd test` & `npm.cmd run prisma:validate`):**
   - `npm.cmd run prisma:validate` -> **PASS (exit code 0)**.
   - `npm.cmd test` -> **PASS (exit code 0) — 183/183 tests PASS (`fail 0`)**.
5. **Validasi Admin Panel & Public Website:**
   - Admin Panel `npm.cmd test` -> **PASS (exit code 0) — 12/12 tests PASS**.
   - Admin Panel `npm.cmd run build` -> **PASS (exit code 0) — 60 modules transformed**.
   - Admin Panel `npm.cmd run validate` -> **PASS (exit code 0) — 10 route modules, 0 iframe bridge, 16 archive files**.
   - Public Website `npm.cmd run build:css` -> **PASS (exit code 0)**.
   - Public Website `npm.cmd run test:stabilization` -> **PASS (exit code 0) — 5 halaman, 63 ID prototipe diarsipkan, 708 token class dicakup**.
6. **Real PostgreSQL 3-Server Browser E2E (`verify-postgres-browser-e2e.mjs` dengan Google Chrome Headless):**
   - **PASS (exit code 0)** terhadap Backend riil (`src/server.js` pada `127.0.0.1:3000` terhubung ke PostgreSQL `127.0.0.1:5432/anantalia_validation_test`), Public Website (`127.0.0.1:4173`), dan Admin Panel (`127.0.0.1:5173`):
     - Katalog publik memuat model terverifikasi (`Toyota Alphard Executive`) dari PostgreSQL.
     - Form publik mengirim booking baru -> menghasilkan kode `BK-TB3-SW4` dan tersimpan di tabel `"Booking"` PostgreSQL dengan status `waiting_confirmation`.
     - Admin login dengan email + password + kode TOTP MFA 6 digit -> menerbitkan cookie `__session` (`HttpOnly`) dan `__csrf`.
     - Admin Panel menampilkan booking `BK-TB3-SW4` dan mengubah status `waiting_confirmation` -> `under_verification` -> `confirmed`; perubahan status terverifikasi langsung di tabel `"Booking"` PostgreSQL.
     - Proses Backend (`src/server.js`) dihentikan dan dijalankan ulang (restart) -> Admin Panel di-reload dan menampilkan kembali sesi, daftar booking, serta status `confirmed` dari PostgreSQL.
     - Seluruh 10 halaman native Admin Panel dikunjungi di Chrome headless dengan **0 console/page/HTTP error**.
     - Seluruh fixture E2E yang dibuat dibersihkan secara spesifik berdasarkan ID pada blok `finally`.

---

### 3. BLOCKED_BY_LOCAL_ENVIRONMENT

- **Tidak ada blocker lingkungan lokal yang tersisa (`NONE`).**
  Layanan PostgreSQL `16.15` pada `127.0.0.1:5432` (`anantalia_validation_test`, role `validation_user`), Node.js, dan Google Chrome headless semuanya telah diverifikasi bekerja penuh di mesin lokal.

---

### 4. BLOCKED_BY_OWNER_DECISION

Fitur bisnis/kebijakan berikut telah memiliki pengaman fail-closed di kode dan didokumentasikan secara lengkap pada [`docs/operations/owner-signoff-checklist.md`](file:///c:/Project%20Mandiri/anantalia-trans-backend/docs/operations/owner-signoff-checklist.md), namun aktivasi operasional produksinya menunggu tanda tangan pemilik bisnis (`PENDING_OWNER_CONFIRMATION`):

1. **`Q-AUTH-001` / `Q-AUTH-002`:** Pemilihan provider/issuer OIDC produksi (saat ini OIDC dinonaktifkan; hanya Self-Hosted Login + TOTP MFA yang aktif).
2. **`Q-AUTH-003` / `Q-RBAC-012` / `Q-SEC-001`:** Penunjukan pejabat **Recovery Authority** dan SOP verifikasi break-glass jika `SUPER_ADMIN` terakhir kehilangan perangkat MFA.
3. **`Q-SEC-002` / `Q-SEC-003` / `Q-SEC-004` / `Q-SEC-006`:** Pengesahan formal Policy Owner untuk baseline password NIST SP 800-63B-4, parameter TTL sesi/rate-limit produksi, dan masa retensi `ActivityLog`.
4. **`Q-SEC-005`:** Pemilihan provider email transaksional untuk pengiriman undangan admin / reset password.
5. **`Q-FLEET-001` / `Q-FLEET-002` / `Q-FLEET-003` / `Q-MIG-003`:** Pengesahan daftar final model kendaraan produksi (`isVerified = true`), opsi sewa (`with_driver` / `self_drive`), dan kebijakan penugasan unit fisik.
6. **`Q-BOOK-001` .. `Q-BOOK-004`:** Pengesahan SOP transisi status booking, batas waktu/durasi pemesanan di zona waktu operasional, cakupan wilayah penjemputan, serta teks pemberitahuan privasi & masa retensi data pelanggan.
7. **`Q-PRICE-001` .. `Q-PRICE-005`:** Pengesahan daftar tarif resmi per model/durasi/rute, komponen biaya tambahan, aturan pajak, dan kebijakan maker-checker sebelum harga dipublikasikan.
8. **`Q-WA-001` / `Q-WA-002`:** Verifikasi nomor WhatsApp bisnis resmi untuk handoff tindak lanjut pesanan (penyimpanan booking di PostgreSQL berjalan mandiri tanpa ketergantungan pada WhatsApp).
9. **`Q-MIG-001` / `Q-MIG-002`:** Konfirmasi memulai database produksi dalam keadaan kosong bersih (tanpa impor data prototipe/dummy).

---

### 5. BLOCKED_BY_PRODUCTION_INFRASTRUCTURE

Sebelum sistem dibuka untuk trafik publik produksi (go-live), prasyarat infrastruktur produksi berikut harus disiapkan oleh tim DevOps/Operator sesuai [`docs/operations/production-deployment-guide.md`](file:///c:/Project%20Mandiri/anantalia-trans-backend/docs/operations/production-deployment-guide.md):

1. **Provisioning Server, Domain & TLS/Reverse Proxy:** Penyediaan host produksi, sertifikat TLS/HTTPS valid untuk domain publik dan admin, serta konfigurasi reverse proxy (Nginx/Cloudflare) yang meneruskan header `X-Forwarded-For` / `X-Forwarded-Proto`.
2. **Production Secrets Management:** Injeksi `DATABASE_URL` produksi (role aplikasi non-superuser), `CSRF_SECRET` (32 byte base64url), `TOTP_ACTIVE_KEY_ID`, `TOTP_KEYRING` (32 byte AES-256-GCM key base64url), dan parameter `ARGON2_*` melalui secret manager produksi.
3. **Shared Rate-Limit Store (Jika Multi-Instance):** Mengganti/menambahkan backing store terdistribusi (mis. Redis) pada `rate-limit.middleware.js` apabila backend dijalankan lebih dari satu replika kontainer.
4. **Backup, Restore & Monitoring Rehearsal:** Penjadwalan backup harian `pg_dump -Fc` terenkripsi, uji coba restore (`pg_restore`) pada staging/recovery host, serta pengaktifan alerting pada endpoint `GET /health`.

---

## Daftar File yang Dibuat atau Diubah pada Tahap Ini

| File | Perubahan |
|---|---|
| [`connection-check.mjs`](file:///c:/Project%20Mandiri/anantalia-trans-backend/connection-check.mjs) | Normalisasi `inet_server_addr()::text` (`127.0.0.1/32` -> `127.0.0.1`) untuk PostgreSQL 16. |
| [`tests/integration/setup/database-setup.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/tests/integration/setup/database-setup.js) | Dukungan loopback `127.0.0.1/32` pada `assertPgIdentity` dan `createTestPrismaClient`. |
| [`scripts/prisma-migrate-test.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/scripts/prisma-migrate-test.js) | Penerapan transaksional 8 migrasi SQL terverifikasi melalui `createTestPgClient` setelah preflight SQL lolos ketika autentikasi menggunakan `pg`. |
| [`src/lib/prisma.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/src/lib/prisma.js) | Injeksi parameter sesi `-c TimeZone=UTC` pada connection string `@prisma/adapter-pg` agar serialisasi `Date` (`formatDateTime`) selaras dengan `TIMESTAMPTZ` PostgreSQL. |
| [`tests/helpers/cleanup-user-fixtures.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/tests/helpers/cleanup-user-fixtures.js) | Kompatibilitas delegasi model `(tx.oidcIdentity ?? tx.oIDCIdentity).deleteMany` untuk Prisma Client riil dan unit mock. |
| [`tests/integration/auth.constraints.test.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/tests/integration/auth.constraints.test.js) | Perbaikan pemanggilan `createTestPgClient()` dan kode SQLSTATE restrict/foreign-key (`23001` / `23503`). |
| [`tests/integration/authentication-orchestration.test.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/tests/integration/authentication-orchestration.test.js) | Inisialisasi parameter Argon2id test-only default saat variabel environment belum diset. |
| [`tests/integration/http-auth.test.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/tests/integration/http-auth.test.js) | Inisialisasi parameter Argon2id test-only default saat variabel environment belum diset. |
| [`src/middlewares/rate-limit.middleware.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/src/middlewares/rate-limit.middleware.js) | Penambahan rate limiter `checkPublicBooking` (30 req/menit/IP). |
| [`src/booking/booking.routes.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/src/booking/booking.routes.js) | Integrasi `rateLimitMiddleware.checkPublicBooking` dan sanitasi error `500` (`sendRouteError`). |
| [`src/customer/customer.routes.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/src/customer/customer.routes.js), [`src/pricing/pricing.routes.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/src/pricing/pricing.routes.js), [`src/finance/finance.routes.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/src/finance/finance.routes.js), [`src/inbox/inbox.routes.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/src/inbox/inbox.routes.js), [`src/content/content.routes.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/src/content/content.routes.js), [`src/analytics/analytics.routes.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/src/analytics/analytics.routes.js), [`src/settings/settings.routes.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/src/settings/settings.routes.js) | Sanitasi respons error `500` agar tidak membocorkan pesan exception internal. |
| [`src/pricing/pricing.service.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/src/pricing/pricing.service.js), [`src/finance/finance.service.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/src/finance/finance.service.js) | Validasi `Number.isSafeInteger` pada nominal `baseRate` dan `amount`. |
| [`src/auth/http-session-adapter.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/src/auth/http-session-adapter.js) | Penambahan atribut `httpOnly: true` dan `secure` pada `clearCookie`. |
| [`tests/unit/rbac-security-audit.test.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/tests/unit/rbac-security-audit.test.js) | Penambahan pengujian negatif untuk integer moneter, sanitasi error `500`, dan rate limit booking publik. |
| [`docs/operations/production-deployment-guide.md`](file:///c:/Project%20Mandiri/anantalia-trans-backend/docs/operations/production-deployment-guide.md) | Panduan deployment produksi, reverse proxy, secret, migrasi, dan backup/restore. |
| [`docs/operations/owner-signoff-checklist.md`](file:///c:/Project%20Mandiri/anantalia-trans-backend/docs/operations/owner-signoff-checklist.md) | Checklist keputusan bisnis terbuka (`PENDING_OWNER_CONFIRMATION`) beserta pengaman fail-closed. |
| [`docs/operations/final-readiness-report.md`](file:///c:/Project%20Mandiri/anantalia-trans-backend/docs/operations/final-readiness-report.md) | Laporan kesiapan operasional akhir ini. |
| [`docs/architecture/implementation-readiness.md`](file:///c:/Project%20Mandiri/anantalia-trans-backend/docs/architecture/implementation-readiness.md), [`README.md`](file:///c:/Project%20Mandiri/anantalia-trans-backend/README.md) | Sinkronisasi status verifikasi PostgreSQL dan panduan operasional. |
| [`src/content/content.service.js`](file:///c:/Project%20Mandiri/anantalia-trans-backend/src/content/content.service.js) | Penegakan izin `CONTENT_APPROVE` (`OWN-009`) saat mengubah status konten ke `published`. |
| [`src/services/api-client.js`](file:///C:/Project%20Mandiri/New%20folder/Dashboard%20Anatalia/stitch_anantalia_trans_admin_panel/src/services/api-client.js) | Pemetaan pesan kesalahan berbahasa Indonesia pada `ApiError` dan penambahan fungsi `createAdminAccount` (`POST /api/admin/create`). |
| [`src/pages/native/bookings.js`](file:///C:/Project%20Mandiri/New%20folder/Dashboard%20Anatalia/stitch_anantalia_trans_admin_panel/src/pages/native/bookings.js), [`src/pages/native/analytics.js`](file:///C:/Project%20Mandiri/New%20folder/Dashboard%20Anatalia/stitch_anantalia_trans_admin_panel/src/pages/native/analytics.js) | Perbaikan selektor badge `DEMO / Prototype UI` (`el.children.length === 0`) agar hanya menyembunyikan badge pill tanpa menyembunyikan wrapper halaman `<main>`. |
| [`src/pages/native/customers.js`](file:///C:/Project%20Mandiri/New%20folder/Dashboard%20Anatalia/stitch_anantalia_trans_admin_panel/src/pages/native/customers.js) | Perbaikan selektor badge `DEMO / Prototype UI` serta penambahan aksi **Edit** pelanggan (`updateCustomer` / `CUSTOMER_UPDATE`) mendampingi fitur tambah, cari, dan hapus. |
| [`src/pages/native/pricing.js`](file:///C:/Project%20Mandiri/New%20folder/Dashboard%20Anatalia/stitch_anantalia_trans_admin_panel/src/pages/native/pricing.js) | Perbaikan selektor badge `DEMO / Prototype UI`, penambahan filter jenis sewa, pencarian kode model, validasi `Number.isSafeInteger`, dan aksi **Edit** aturan tarif (`updatePricing` / `PRICING_UPDATE`). |
| [`src/pages/native/content.js`](file:///C:/Project%20Mandiri/New%20folder/Dashboard%20Anatalia/stitch_anantalia_trans_admin_panel/src/pages/native/content.js) | Perbaikan selektor badge `DEMO / Prototype UI`, penambahan filter status & pencarian, aksi **Edit** konten (`CONTENT_UPDATE`), serta tombol **Publikasikan / Jadikan Draft** (`CONTENT_APPROVE`). |
| [`src/pages/native/messages.js`](file:///C:/Project%20Mandiri/New%20folder/Dashboard%20Anatalia/stitch_anantalia_trans_admin_panel/src/pages/native/messages.js) | Perbaikan selektor badge `DEMO / Prototype UI`, penambahan filter status pesan (`unread`, `read`, `archived`), pencarian, dan tampilan riwayat catatan internal (`item.notes`). |
| [`src/pages/native/finance.js`](file:///C:/Project%20Mandiri/New%20folder/Dashboard%20Anatalia/stitch_anantalia_trans_admin_panel/src/pages/native/finance.js) | Perbaikan selektor badge `DEMO / Prototype UI`, penambahan filter tipe transaksi (`income` / `expense`), dan validasi `Number.isSafeInteger` pada pencatatan transaksi. |
| [`src/pages/native/settings.js`](file:///C:/Project%20Mandiri/New%20folder/Dashboard%20Anatalia/stitch_anantalia_trans_admin_panel/src/pages/native/settings.js) | Penambahan tombol **Tambah Akun Admin** (`USER_CREATE`) pada panel manajemen akun administrator. |

---

## Matriks Keputusan Release Gate & UAT (Pre-Production Acceptance)

### 1. PASS (Terbukti dengan Pengujian Otomatis & Live PostgreSQL Browser E2E)
- **Integrasi Backend & PostgreSQL (`127.0.0.1:5432/anantalia_validation_test`):** 22 model Prisma, 8 migrasi SQL transaksional, `183/183` unit/contract test PASS, dan `27/27` PostgreSQL integration test PASS.
- **Keamanan Autentikasi, MFA, Session, CSRF, RBAC & Rate Limiting:** Argon2id password hashing, TOTP MFA AES-256-GCM keyring + replay protection, single-use MFA completion proof, rotasi sesi SHA-256, cookie `HttpOnly` + `SameSite=Lax`, double-submit HMAC CSRF (`__csrf` + `X-CSRF-Token`), matriks RBAC `OWN-009` (`SUPER_ADMIN`, `ADMIN`, `STAFF`), rate limiting (`checkLogin`, `checkMfaVerify`, `checkPublicBooking`), dan sanitasi respons error `500`.
- **10 Modul Native Admin Panel (`12/12` unit test, `vite build`, `validate-native` PASS):**
  1. `dashboard`: Ringkasan metrik operasional & armada dari PostgreSQL.
  2. `bookings`: Daftar, pencarian, filter status, detail, dan transisi state machine (`waiting_confirmation` -> `under_verification` -> `confirmed` / `rejected` / `cancelled` -> `completed`).
  3. `fleet`: Lihat, cari, filter kategori/status/verifikasi, tambah kategori & model, ubah model (`isVerified`), nonaktifkan model, dan atur opsi sewa (`with_driver` / `self_drive`).
  4. `customers`: Lihat, cari (`q`), tambah (`CUSTOMER_CREATE`), ubah (`CUSTOMER_UPDATE`), dan soft-delete (`CUSTOMER_DELETE`).
  5. `pricing`: Lihat, cari kode model, filter jenis sewa, tambah (`PRICING_CREATE`), ubah (`PRICING_UPDATE`), dan nonaktifkan (`PRICING_DELETE`) dengan validasi integer Rupiah (`Number.isSafeInteger`).
  6. `finance`: Lihat daftar & ringkasan (`totalRevenue`, `totalExpenses`, `netProfit`), filter tipe (`income` / `expense`), dan catat transaksi (`FINANCE_CREATE`) dengan validasi integer Rupiah positif.
  7. `messages`: Lihat, cari (`q`), filter status (`unread`, `read`, `archived`), tandai dibaca/arsipkan (`MESSAGE_UPDATE`), serta tambah & tampilkan catatan internal (`InboxMessageNote`).
  8. `content`: Lihat, cari (`q`), filter status (`draft`, `published`, `archived`), buat (`CONTENT_CREATE`), ubah (`CONTENT_UPDATE`), publikasikan (`CONTENT_APPROVE`), dan hapus (`CONTENT_DELETE`).
  9. `analytics`: Ringkasan metrik booking (`7d`, `30d`, `90d`) dan ekspor laporan JSON (`ANALYTICS_EXPORT`).
  10. `settings`: Profil pribadi & ganti password, enroll/confirm/revoke TOTP MFA, manajemen akun admin (tambah `USER_CREATE`, ubah role `USER_UPDATE_ROLE`, suspend/reactivate `USER_UPDATE_STATUS`, hapus `USER_DELETE`), pengaturan sistem (`SETTINGS_VIEW` / `SETTINGS_UPDATE`), dan pencabutan seluruh sesi aktif (`POST /auth/sessions/revoke-all`).
- **Public Website (`build:css` & `test:stabilization` PASS):** 5 halaman bebas Tailwind CDN dan bebas kebocoran data prototipe (`data/legacy-prototype-vehicles.json` terisolasi), katalog armada terverifikasi dari API publik, validasi form booking publik (nama, telepon E.164 `+62...`, tanggal kalender ISO valid, lokasi >= 3 karakter, pencegahan duplikasi `409`), serta pemberitahuan eksplisit ketika nomor WhatsApp resmi belum dikonfirmasi (`whatsapp.available: false`).

### 2. FAIL (Bug Implementasi yang Belum Terselesaikan)
- **Tidak ada (`0 FAIL`).** Seluruh temuan teknis selama pemeriksaan pra-produksi (normalisasi timezone UTC pada `@prisma/adapter-pg`, kelengkapan tombol Edit/Filter pada Admin Panel, penegakan `CONTENT_APPROVE`, dan pemetaan pesan `ApiError`) telah diperbaiki dan diverifikasi lulus pengujian.

### 3. PENDING_OWNER_CONFIRMATION (Keputusan Bisnis Terbuka)
- Lihat bagian **4. BLOCKED_BY_OWNER_DECISION** di atas dan [`docs/operations/owner-signoff-checklist.md`](file:///c:/Project%20Mandiri/anantalia-trans-backend/docs/operations/owner-signoff-checklist.md) (`Q-AUTH-001..003`, `Q-SEC-001..006`, `Q-FLEET-001..003`, `Q-BOOK-001..004`, `Q-PRICE-001..005`, `Q-WA-001..002`, `Q-MIG-001..003`).

### 4. PENDING_PRODUCTION_INFRASTRUCTURE (Infrastruktur Produksi)
- Lihat bagian **5. BLOCKED_BY_PRODUCTION_INFRASTRUCTURE** di atas dan [`docs/operations/production-deployment-guide.md`](file:///c:/Project%20Mandiri/anantalia-trans-backend/docs/operations/production-deployment-guide.md) (server produksi, domain & TLS/reverse proxy, injeksi secret produksi, shared rate-limit store untuk multi-instance, dan uji coba backup/restore).

### Kesimpulan Kelayakan Release Gate
- **Status Kesiapan UAT (User Acceptance Testing): LAYAK MASUK TAHAP UAT (`READY FOR UAT`).** Seluruh alur fungsional, keamanan, RBAC, dan persistensi PostgreSQL pada Backend, Public Website, dan Admin Panel telah terintegrasi penuh dan terbukti lulus pengujian otomatis serta E2E browser nyata.
- **Status Kesiapan Rilis Produksi Publik: MENUNGGU SIGN-OFF BISNIS & INFRASTRUKTUR (`HOLD FOR OWNER SIGN-OFF & PRODUCTION INFRASTRUCTURE`).** Rilis ke publik hanya tinggal menunggu penyelesaian item pada kategori `PENDING_OWNER_CONFIRMATION` dan `PENDING_PRODUCTION_INFRASTRUCTURE`.

---

## Ringkasan Perintah Validasi, Exit Code & Jumlah Test

| Workspace / Target | Perintah | Exit Code | Hasil / Jumlah Test |
|---|---|---|---|
| PostgreSQL Service & Port Check | `Get-Service postgresql*` & `pg_isready.exe -h 127.0.0.1 -p 5432` | `0` | `postgresql-x64-16` (`Running`), `127.0.0.1:5432 - accepting connections` |
| SQL Identity Preflight | `node connection-check.mjs` | `0` | `{"database":"anantalia_validation_test","role":"validation_user","server_address":"127.0.0.1","server_port":5432}` |
| PostgreSQL Migration Test | `npm.cmd run prisma:migrate:test` | `0` | 8/8 migrasi diterapkan & diverifikasi idempoten |
| Backend Prisma Validate | `npm.cmd run prisma:validate` | `0` | Schema `prisma/schema.prisma` valid (22 model) |
| Backend Unit & Contract Tests | `npm.cmd test` | `0` | **183/183 PASS** (`fail 0`) |
| Backend PostgreSQL Integration Tests | `npm.cmd run test:db` | `0` | **27/27 PASS** (`fail 0`) |
| Admin Panel Unit Tests | `npm.cmd test` | `0` | **12/12 PASS** (`fail 0`) |
| Admin Panel Production Build | `npm.cmd run build` | `0` | **PASS** (`dist/` generated, 60 modules) |
| Admin Panel Native Validation | `npm.cmd run validate` | `0` | **PASS** (10 route modules, no iframe bridge) |
| Public Website CSS Build | `npm.cmd run build:css` | `0` | **PASS** (`css/tailwind.generated.css` rebuilt) |
| Public Website Stabilization | `npm.cmd run test:stabilization` | `0` | **PASS** (5 halaman, 708 class tokens, 0 prototype leak) |
| Real PostgreSQL Browser E2E | `node verify-postgres-browser-e2e.mjs` | `0` | **PASS** (`POSTGRES_BROWSER_E2E_COMPLETE: PASS`, 0 browser/network errors, fixture cleanup verified) |

---

## Langkah Konkret Berikutnya menuju Go-Live Produksi

1. **Tanda Tangan Pemilik Bisnis:** Tinjau dan lengkapi kolom persetujuan pada [`docs/operations/owner-signoff-checklist.md`](file:///c:/Project%20Mandiri/anantalia-trans-backend/docs/operations/owner-signoff-checklist.md) untuk keputusan berstatus `PENDING_OWNER_CONFIRMATION`.
2. **Persiapan Host & Secret Produksi:** Siapkan server produksi, database PostgreSQL produksi terisolasi, TLS/reverse proxy, dan secret produksi mengikuti [`docs/operations/production-deployment-guide.md`](file:///c:/Project%20Mandiri/anantalia-trans-backend/docs/operations/production-deployment-guide.md).
3. **Inisialisasi Skema & Akun Pertama di Produksi:** Jalankan `npx prisma migrate deploy`, seed role/permission resmi (`seedRolesAndPermissions`), dan buat akun `SUPER_ADMIN` pertama (`scripts/bootstrap-super-admin.js`), lalu aktifkan TOTP MFA dan masukkan hanya katalog armada yang telah disahkan oleh pemilik bisnis.
