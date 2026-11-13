# STAGE 7 RELEASE CANDIDATE REPORT — ANATALIA TRANS

**Tanggal Validasi:** 2026-11-13  
**Workspace yang Diaudit & Divalidasi:**
1. **Backend API:** `C:/Project Mandiri/anantalia-trans-backend` (Node.js 26.x, Express 5.3.0, Prisma 7.10.1, PostgreSQL 18)
2. **Public Website:** `C:/Project Mandiri/New folder/anatlia` (HTML statis 5 halaman, Vanilla JS, Tailwind CSS CLI)
3. **Admin Panel:** `C:/Project Mandiri/New folder/Dashboard Anatalia/stitch_anantalia_trans_admin_panel` (JS Modular, Vite 6.4.5, Playwright Chromium)

---

## 1. Executive Release Decision

> **KEPUTUSAN RELEASE CANDIDATE: `READY WITH BLOCKERS`**

Seluruh validasi teknis Release Candidate pada **Backend API**, **Public Website**, **Admin Panel**, **10 migrasi PostgreSQL 18**, **container hardened Node 26 (`v26.13.1`)**, **audit dependensi (`npm audit`)**, serta **simulasi Live Staging Full-Stack Browser E2E** berstatus **LULUS (`0` kegagalan teknis)** setelah perubahan kode terakhir.

Namun demikian, **status go-live publik tetap tertahan (`READY WITH BLOCKERS`)** oleh **blocker non-kode / bisnis dan infrastruktur produksi**:
1. **`PENDING_OWNER_CONFIRMATION`** pada [owner-signoff-checklist.md](file:///C:/Project%20Mandiri/anantalia-trans-backend/docs/operations/owner-signoff-checklist.md) (`Q-AUTH-001`..`003`, `Q-RBAC-012`, `Q-SEC-001`..`006`, `Q-FLEET-001`..`003`, `Q-BOOK-001`..`004`, `Q-PRICE-001`..`005`, `Q-WA-001`..`002`, `Q-MIG-001`..`003`). Fitur terkait tetap aman (*fail-closed*) di kode dan **tidak dibuka sepihak** tanpa otorisasi pemilik bisnis.
2. **Infrastruktur Produksi (`PENDING_PRODUCTION_INFRASTRUCTURE`):** provisioning host produksi, domain & terminasi TLS/HTTPS reverse proxy same-origin, injeksi secret manager produksi, client `pg_dump`/`pg_restore` PG 18 pada host/container operator (client native Windows lokal gagal karena loader error `-1073741515`), serta store rate-limiter terdistribusi apabila backend dijalankan multi-replika.

---

## 2. Ruang Lingkup & Metode Verifikasi (Pemisahan Bukti)

Laporan ini memisahkan tegas lima kategori bukti agar tidak terjadi bias antara uji terisolasi dan runtime nyata:

| Kategori Pengujian | Ruang Lingkup & Kredibilitas Bukti | Status |
|---|---|---|
| **A. Unit & Contract Tests (Node Host + Node 26 Container)** | Logika bisnis, RBAC `OWN-009`, mesin status booking, CSRF, TOTP AES-256-GCM, OpenAPI parity dengan repository in-memory / mock terisolasi | **LULUS (`196/196`)** |
| **B. Mocked Browser E2E (Admin Panel)** | Interaksi seluruh tombol, modal, filter, sorting, pagination, ekspor CSV/Excel, MFA flow, dan penugasan unit via mock API terstruktur (`tests/e2e-full-button-matrix.mjs`) | **LULUS (`50/50`)** |
| **C. PostgreSQL 18 Integration & Backup/Restore** | Database ephemeral `anantalia_t7_iso_test` + dump/restore `anantalia_t7_dump_src_test` -> `anantalia_t7_dump_dst_test` pada container PG 18 (`127.0.0.1:5433`, 10 migrasi SQL nyata, constraints & concurrency lock) | **LULUS (`28/28` + Dump/Restore Parity)** |
| **D. Hardened Docker Runtime (`node:26-bookworm-slim`)** | Container produksi (`uid=1000(node)`, `--read-only`, `--tmpfs /tmp`, `--security-opt no-new-privileges:true`, `--cap-drop ALL`) terhubung ke PG 18 + probe endpoint | **LULUS** |
| **E. Live Staging Full-Stack E2E (3 Server Riil + PG 18 + Chromium)** | Tanpa mock backend: PostgreSQL 18 riil (`anantalia_t7_staging_test`), Backend riil (`src/server.js`), Public server (`anatlia/scripts/serve.js`), Admin (`vite preview`), browser headless Chromium (`staging-e2e.mjs`) | **LULUS (`10/10` Skenario End-to-End)** |

---

## 3. Temuan Teknis & Perbaikan yang Diselesaikan pada Tahap 7

1. **Bug P1 — Inkonsistensi Kontrak API `listAvailableUnitsForBooking` (Terungkap saat Live Staging E2E):**
   - **Akar Masalah:** Method [`listAvailableUnitsForBooking`](file:///C:/Project%20Mandiri/anantalia-trans-backend/src/booking/prisma-booking.repository.js#L192-L253) mengembalikan array mentah berisi `isAvailableForSchedule` tanpa `odometerKm` serta melewatkan unit berstatus `'maintenance'`, sedangkan Admin Panel ([`bookings.js`](file:///C:/Project%20Mandiri/New%20folder/Dashboard%20Anatalia/stitch_anantalia_trans_admin_panel/src/pages/native/bookings.js#L508-L513)) mengharapkan objek `{ bookingId, items: [...] }` dengan boolean `available`.
   - **Perbaikan:**
     - [`prisma-booking.repository.js`](file:///C:/Project%20Mandiri/anantalia-trans-backend/src/booking/prisma-booking.repository.js#L192-L253): menyertakan status `'maintenance'` (alasan `'Unit sedang dalam perawatan'`), field `odometerKm`, serta mengembalikan `{ bookingId, items }` dengan kedua properti `available` dan `isAvailableForSchedule`.
     - [`booking.service.js`](file:///C:/Project%20Mandiri/anantalia-trans-backend/src/booking/booking.service.js#L645-L655): menormalkan hasil array dari repository menjadi `{ bookingId, items: result }`.
     - [`booking-fleet-finance.postgres.test.js`](file:///C:/Project%20Mandiri/anantalia-trans-backend/tests/integration/booking-fleet-finance.postgres.test.js#L165-L199): menambah assertion PostgreSQL nyata sebelum assignment (`available === true`) dan saat bentrok jadwal (`available === false`, `conflictReason` memuat `'Bentrok'`).
2. **Klarifikasi Perilaku Endpoint Publik `GET /api/v1/public/vehicle-models`:**
   - Memverifikasi di `fleet.service.js` dan `docs/api/openapi.yaml` bahwa `categoryId` (UUID) dan `rentalType` (`self_drive`|`with_driver`) adalah parameter wajib sesuai desain kontrak; permintaan tanpa keduanya sengaja mengembalikan `400 INVALID_INPUT`. Didokumentasikan pada Skenario 7 [`operational-runbook.md`](file:///C:/Project%20Mandiri/anantalia-trans-backend/docs/operations/operational-runbook.md#L78).
3. **Verifikasi Hardened Runtime Container Node 26 & Env Safety:**
   - Mengonfirmasi di [`src/server.js`](file:///C:/Project%20Mandiri/anantalia-trans-backend/src/server.js#L100-L145) dan [`src/middlewares/csrf.middleware.js`](file:///C:/Project%20Mandiri/anantalia-trans-backend/src/middlewares/csrf.middleware.js#L1-L30) bahwa `NODE_ENV=production` berjalan *fail-closed* menonaktifkan router auth/admin jika `CSRF_SECRET` bukan 32+ byte `base64url`, `TOTP_KEYRING` tidak valid, atau `ARGON2_*` tidak lengkap.
4. **Sinkronisasi Dokumentasi Operasional:**
   - Memperbarui [`README.md`](file:///C:/Project%20Mandiri/anantalia-trans-backend/README.md), [`production-deployment-guide.md`](file:///C:/Project%20Mandiri/anantalia-trans-backend/docs/operations/production-deployment-guide.md), [`operational-runbook.md`](file:///C:/Project%20Mandiri/anantalia-trans-backend/docs/operations/operational-runbook.md), dan [`postgres-backup-restore.md`](file:///C:/Project%20Mandiri/anantalia-trans-backend/docs/operations/postgres-backup-restore.md) agar selaras dengan 10 migrasi SQL, port container test `5432`/`5433`, perbedaan respons `401 UNAUTHENTICATED` vs `403 CSRF_INVALID`/`FORBIDDEN`, serta prosedur dump/restore containerized PostgreSQL 18.

---

## 4. Matriks Verifikasi Pasca-Edit Terkini (Command, Exit Code & Hasil Aktual)

Seluruh pemeriksaan di bawah dieksekusi **setelah perubahan kode terakhir** pada masing-masing workspace:

| Workspace | Perintah / Pengujian | Exit Code | Hasil Observasi Aktual |
|---|---|---|---|
| **Backend** | `npm.cmd run prisma:validate` | `0` | Schema `prisma/schema.prisma` valid (10 migrasi di `prisma/migrations`) |
| **Backend** | `npm.cmd test` | `0` | **196/196 PASS** (`fail 0`, `cancelled 0`, `skipped 0`, `3463.459ms`) |
| **Backend + PG 18** | `npm.cmd run test:db:isolated` (`anantalia_t7_iso_test` @ `127.0.0.1:5433`) | `0` | **28/28 PASS** (`fail 0`, `cancelled 0`, `skipped 0`, `16490.5528ms`), termasuk uji assignment & konflik unit nyata |
| **PG 18 Container** | `pg_dump --format=custom` -> `pg_restore --exit-on-error` (`anantalia_t7_dump_src_test` -> `anantalia_t7_dump_dst_test`) | `0` | `DUMP_RESTORE_OK src_tables=26 dst_tables=26 dst_migrations=10 dst_checks=32` |
| **Docker Node 26 (Build)** | `docker run ... node --test tests/unit/*.test.js` (`v26.13.1`) | `0` | **196/196 PASS** (`fail 0`, `skipped 0`, `2472.241487ms`) |
| **Docker Node 26 (Runtime)** | Container `--read-only`, `--tmpfs /tmp`, `--security-opt no-new-privileges:true`, `--cap-drop ALL`, `uid=1000(node)` | `0` | `/health` `200`, `/auth/csrf` `200` (`Secure`, `Lax`, no `ACAO *`), `/public/vehicle-categories` `200`, `/public/vehicle-models` tanpa query `400` / ber-query `200`, `/admin/bookings` unauth `401` |
| **Admin Panel** | `npm.cmd test` | `0` | **15/15 PASS** (`0` fail, `0` skipped, `374.6379ms`) |
| **Admin Panel** | `npm.cmd run build` | `0` | Vite `v6.4.5`, `63 modules transformed`, `9.78s` |
| **Admin Panel** | `npm.cmd run validate` | `0` | `PASS: production archive (16 files) and page chunks (10)` |
| **Admin Panel** | `node tests/e2e-full-button-matrix.mjs` (Mocked Playwright E2E) | `0` | **50/50** kelompok interaksi (`BTN-001`..`BTN-050`) LULUS, `0` console/page error |
| **Public Website** | `npm.cmd run build:css` | `0` | `Done in 3103ms.` (`css/tailwind.generated.css`) |
| **Public Website** | `npm.cmd run test:stabilization` | `0` | `LULUS`: 5 halaman, 63 ID prototipe terarsip, katalog API aktif, 0 Tailwind CDN, 744 token class |
| **Bundle Security Scan** | `rg` pemindaian secret/localhost pada Admin `dist/` & Public bundle | `1` *(clean)* | **0 temuan** secret, token, atau hardcoded localhost |
| **Supply Chain Audit** | `npm.cmd audit --json` (Backend, Admin, Public) | `0` *(semua 3)* | Backend: `0`, Admin: `0`, Public: `0` kerentanan (`info`/`low`/`moderate`/`high`/`critical` = `0`) |
| **Live Staging E2E** | `run-staging-e2e.ps1` + `staging-e2e.mjs` (PG 18 `anantalia_t7_staging_test` + 3 server riil + Chromium) | `0` | `ALL_STAGING_E2E_PASSED`: static secret/traversal block `404`, public booking `BK-2JA-322` (`201`, `whatsappAvailable=false`), admin unauth `401` redirect, Argon2id + TOTP MFA login, unit assignment `B 7700 STG` + confirm & immutable price snapshot (`2550000`, `locked:true`), finance `income`+`refund` filter & CSV/Excel formula neutralization (`'=CMD...`), session bertahan saat backend restart, DB session revoke -> `401` redirect `#/login`, re-login & logout bersih (`0` sesi aktif di PG, `0` `pageerror`, `0` `5xx`) |

---

## 5. Kebersihan Database & Infrastruktur Lokal

- Database pengembangan utama **`anantalia_backend_dev` tidak pernah dimodifikasi, di-reset, atau ditimpa** sepanjang Tahap 7.
- Seluruh database uji sementara (`anantalia_t7_iso_test`, `anantalia_t7_dump_src_test`, `anantalia_t7_dump_dst_test`, `anantalia_t7_docker_test`, `anantalia_t7_staging_test`) serta container/image probe (`anantalia-t7-runtime-probe`, `anantalia-backend:t7-*`) telah dihapus bersih setelah verifikasi.

---

## 6. Risiko Tersisa & Batasan

1. **Keputusan Pemilik Bisnis (`PENDING_OWNER_CONFIRMATION`):** Go-live dilarang sampai checklist pada [`owner-signoff-checklist.md`](file:///C:/Project%20Mandiri/anantalia-trans-backend/docs/operations/owner-signoff-checklist.md) ditandatangani (khususnya nomor WhatsApp bisnis resmi `Q-WA-001`, daftar armada terverifikasi `Q-FLEET-001`, tarif resmi `Q-PRICE-001..005`, provider email `Q-SEC-005`, dan otoritas pemulihan darurat MFA `Q-AUTH-003`).
2. **Rate Limiter In-Memory Single-Process:** Implementasi [`rate-limit.middleware.js`](file:///C:/Project%20Mandiri/anantalia-trans-backend/src/middlewares/rate-limit.middleware.js) bersifat per-proses; deployment lebih dari satu replika kontainer mewajibkan rate limiting tambahan pada reverse proxy/WAF atau shared store (mis. Redis).
3. **Klien Backup Lokal Windows:** Binary `pg_dump.exe`/`pg_restore.exe` host Windows gagal dijalankan (`-1073741515`), sedangkan klien PG 18 di dalam container (`anantalia-postgres18-validation`) terverifikasi sukses penuh. Operasional produksi wajib menjalankan dump/restore dari host Linux/container PostgreSQL 18.
4. **TLS Reverse Proxy Eksternal:** Cookie `__session` dan `__csrf` produksi menyetel atribut `Secure` ketika `NODE_ENV=production`, sehingga pengujian reverse proxy HTTPS/TLS riil dengan sertifikat domain harus divalidasi saat provisioning server staging/produksi final.

---

## 7. Daftar Berkas Utama yang Diubah / Dihasilkan pada Tahap 7

- [`src/booking/prisma-booking.repository.js`](file:///C:/Project%20Mandiri/anantalia-trans-backend/src/booking/prisma-booking.repository.js)
- [`src/booking/booking.service.js`](file:///C:/Project%20Mandiri/anantalia-trans-backend/src/booking/booking.service.js)
- [`tests/integration/booking-fleet-finance.postgres.test.js`](file:///C:/Project%20Mandiri/anantalia-trans-backend/tests/integration/booking-fleet-finance.postgres.test.js)
- [`README.md`](file:///C:/Project%20Mandiri/anantalia-trans-backend/README.md)
- [`docs/operations/production-deployment-guide.md`](file:///C:/Project%20Mandiri/anantalia-trans-backend/docs/operations/production-deployment-guide.md)
- [`docs/operations/operational-runbook.md`](file:///C:/Project%20Mandiri/anantalia-trans-backend/docs/operations/operational-runbook.md)
- [`docs/operations/postgres-backup-restore.md`](file:///C:/Project%20Mandiri/anantalia-trans-backend/docs/operations/postgres-backup-restore.md)
- [`docs/operations/STAGE-7-RELEASE-CANDIDATE-REPORT.md`](file:///C:/Project%20Mandiri/anantalia-trans-backend/docs/operations/STAGE-7-RELEASE-CANDIDATE-REPORT.md)

---

## 8. Perintah Reproduksi & Operasi Release Candidate

1. **Validasi Backend Unit + Isolated PostgreSQL 18:**
   - Set environment `NODE_ENV=test`, `DATABASE_TEST_OPT_IN=I_CONFIRM_DISPOSABLE_DATABASE`, `TEST_DATABASE_NAME`, `TEST_DATABASE_URL`, `TEST_DATABASE_ALLOWLIST` (port `5432` atau `5433`, role `validation_user`, tanpa menumpuki `DATABASE_URL`).
   - Jalankan `npm.cmd run prisma:validate`, `npm.cmd test`, dan `npm.cmd run test:db:isolated` di `C:/Project Mandiri/anantalia-trans-backend`.
2. **Build & Validasi Frontend:**
   - Admin Panel: `npm.cmd test`, `npm.cmd run build`, `npm.cmd run validate`, dan `node tests/e2e-full-button-matrix.mjs`.
   - Public Website: `npm.cmd run build:css` dan `npm.cmd run test:stabilization`.
3. **Deployment Produksi Terkontrol:**
   - Ikuti urutan pada [`production-deployment-guide.md`](file:///C:/Project%20Mandiri/anantalia-trans-backend/docs/operations/production-deployment-guide.md) dan [`compose.production.yaml`](file:///C:/Project%20Mandiri/anantalia-trans-backend/compose.production.yaml) setelah seluruh item `PENDING_OWNER_CONFIRMATION` ditandatangani.
