# Production Deployment Guide — Anantalia Trans

Dokumen ini mendeskripsikan prosedur build, konfigurasi environment, reverse proxy, migrasi database, keamanan cookie/CSRF, health check, graceful shutdown, dan backup/restore berdasarkan source code aktual ketiga workspace Anantalia Trans.

> **Penting:** Panduan ini adalah spesifikasi operasional dan kesiapan deployment. Jangan mengaktifkan fitur yang masih memiliki blocker keputusan bisnis atau mengklaim status *production-ready* sebelum gate validasi database `anantalia_validation_test` dan konfirmasi pemilik bisnis diselesaikan.

---

## 1. Arsitektur Komponen & Build Produksi

Sistem terdiri atas tiga aplikasi terpisah yang dikompilasi secara independen:

### A. Backend API (`C:\Project Mandiri\anantalia-trans-backend`)
- **Runtime:** Node.js `>=26 <27`, Express 5, Prisma 7 (`@prisma/adapter-pg`), PostgreSQL 18 (atau PostgreSQL 16.15 untuk disposable validation).
- **Perintah Build & Validasi:**
  ```powershell
  npm.cmd ci
  npm.cmd run prisma:validate
  npm.cmd run prisma:generate
  npm.cmd test
  ```
- **Container Image (`Dockerfile` & `compose.production.yaml`):**
  - Multi-stage build berbasis `node:26-bookworm-slim`.
  - Stage `runtime` berjalan sebagai non-root user (`USER node`), filesystem `read_only: true`, `/tmp` sebagai `tmpfs`, `no-new-privileges:true`, dan `cap_drop: [ALL]`.

### B. Admin Panel (`C:\Project Mandiri\New folder\Dashboard Anatalia\stitch_anantalia_trans_admin_panel`)
- **Build Tool:** Vite 6 (`dist/` static bundle dengan 10 route chunk modul).
- **Perintah Build & Validasi:**
  ```powershell
  npm.cmd ci
  npm.cmd test
  npm.cmd run build
  npm.cmd run validate
  ```
- **Output:** Direktori `dist/` berisi `dist/index.html` dan `dist/assets/*` (termasuk hash nama file untuk cache-busting).

### C. Public Website (`C:\Project Mandiri\New folder\anatlia`)
- **Build Tool:** Tailwind CSS CLI (tanpa CDN runtime).
- **Perintah Build & Validasi:**
  ```powershell
  npm.cmd ci
  npm.cmd run build:css
  npm.cmd run test:stabilization
  ```
- **Output:** 5 halaman HTML statis (`index.html`, `pages/armada.html`, `pages/layanan.html`, `pages/pusat-bantuan.html`, `pages/tentang-kami.html`), `css/tailwind.generated.css`, `runtime-config.js`, dan `js/*`.

---

## 2. Inventaris Environment Variable (Tanpa Nilai Secret)

Seluruh secret wajib disuplai melalui secret manager / environment operator dan tidak boleh ditulis ke dalam repository.

| Variabel | Lingkup | Wajib | Deskripsi & Kontrak Validasi |
| :--- | :--- | :---: | :--- |
| `NODE_ENV` | Backend | Ya | `development`, `test`, atau `production`. Mengaktifkan flag cookie `Secure` saat bernilai `production`. |
| `HOST` | Backend | Tidak | Default `127.0.0.1` (`0.0.0.0` di dalam container). |
| `PORT` | Backend | Tidak | Port TCP integer `1..65535` (default `3000`). |
| `TRUST_PROXY` | Backend | Tidak | Default `loopback`. Menerima `false`, jumlah hop `0..10`, keyword `loopback`/`linklocal`/`uniquelocal`, atau IP/CIDR. Menolak `true`/`*` untuk mencegah spoofing header `X-Forwarded-For`. |
| `DATABASE_URL` | Backend | Ya | Connection string PostgreSQL aplikasi (`postgresql://...`). Tidak boleh menunjuk ke database uji `anantalia_validation_test`. |
| `CSRF_SECRET` | Backend | Ya | Minimal 32 random bytes dalam encoding `base64url` untuk HMAC token CSRF (`__csrf`). |
| `TOTP_ACTIVE_KEY_ID` | Backend | Ya | ID kunci enkripsi aktif yang terdaftar di dalam `TOTP_KEYRING`. |
| `TOTP_KEYRING` | Backend | Ya | JSON object `{ "<keyId>": "<43-char-base64url-32-byte-key>" }` untuk enkripsi AES-256-GCM secret TOTP. |
| `ARGON2_MEMORY_COST` | Backend | Ya | Memory cost Argon2id dalam KiB (`>= 8 * parallelism`). |
| `ARGON2_TIME_COST` | Backend | Ya | Time cost / iterasi Argon2id (integer positif). |
| `ARGON2_PARALLELISM` | Backend | Ya | Degree of parallelism Argon2id (integer positif). |
| `ARGON2_HASH_LENGTH` | Backend | Ya | Panjang output hash Argon2id dalam byte (`>= 4`). |
| `SMTP_WEBHOOK_URL` | Backend | Opsional | URL webhook HTTP/HTTPS untuk pengiriman balasan email dari modul Inbox (`Notifikasi/Email` berstatus `not_configured` bila belum disetel). |
| `VITE_API_BASE_URL` | Admin Panel | Opsional | Base URL API saat build; biarkan kosong untuk arsitektur same-origin reverse proxy. |
| `VITE_PUBLIC_SITE_URL` | Admin Panel | Opsional | URL atau path Public Website untuk tautan `Pratinjau Live Website` di modul Konten (default `/`). |
| `DATABASE_TEST_OPT_IN` | Test DB | Hanya `test` | Wajib bernilai tepat `I_CONFIRM_DISPOSABLE_DATABASE` untuk mengizinkan koneksi/migrasi database uji. |
| `TEST_DATABASE_NAME` | Test DB | Hanya `test` | Wajib bernilai tepat `anantalia_validation_test`. |
| `TEST_DATABASE_ALLOWLIST` | Test DB | Hanya `test` | Wajib memuat host/port/DB disposable, mis. `127.0.0.1:5432/anantalia_validation_test` atau `127.0.0.1:5433/anantalia_validation_test`. |
| `TEST_DATABASE_URL` | Test DB | Hanya `test` | Wajib menunjuk ke `postgresql://validation_user:<password>@127.0.0.1:<5432|5433>/anantalia_validation_test?schema=public`. |

---

## 3. Strategi Migrasi Database

1. **Lingkungan Pengujian Terisolasi (`NODE_ENV=test`):**
   - Hanya boleh dijalankan terhadap database uji `anantalia_validation_test` (`127.0.0.1:5432` atau `127.0.0.1:5433` untuk container validasi PostgreSQL 18) dengan role `validation_user`, atau via runner ephemeral `npm.cmd run test:db:isolated` yang membuat lalu menghapus database uji sementara secara otomatis.
   - Sebelum migrasi, jalankan preflight:
     ```powershell
     node connection-check.mjs
     npm.cmd run prisma:migrate:test
     npm.cmd run test:db
     # atau otomatis ephemeral:
     npm.cmd run test:db:isolated
     ```
2. **Lingkungan Produksi (`NODE_ENV=production`):**
   - Jangan pernah menggunakan `prisma db push` atau `prisma migrate dev` di produksi.
   - Jalankan one-shot migration container sebelum memutar instance `api` baru sesuai `compose.production.yaml`:
     ```sh
     docker compose -f compose.production.yaml --profile migration run --rm migrate
     ```
   - `src/config/prisma-migration-safety.js` memvalidasi bahwa `prisma migrate deploy` hanya diizinkan pada `NODE_ENV=production` dengan `DATABASE_URL` yang sah atau pada `NODE_ENV=test` dengan `getAuthorizedTestDatabase()`.

---

## 4. Topologi Reverse Proxy, HTTPS, Cookie, & Routing

Backend tidak membuka CORS wildcard (`*`) karena autentikasi menggunakan cookie sesi (`__session`) dan double-submit HMAC CSRF (`__csrf`).

### Konfigurasi Reverse Proxy (Nginx / Caddy / Cloud Load Balancer)
- **Terminasi HTTPS (TLS 1.2/1.3):** Wajib diaktifkan di depan seluruh trafik publik dan admin. Saat `NODE_ENV=production`, cookie `__session` (`HttpOnly; SameSite=Lax; Secure; Path=/`) dan `__csrf` (`SameSite=Lax; Secure; Path=/`) hanya dikirim melalui HTTPS.
- **Routing Same-Origin Admin Panel:**
  - `/auth/*` -> proxy ke Backend `http://127.0.0.1:3000/auth/*`
  - `/api/*` -> proxy ke Backend `http://127.0.0.1:3000/api/*`
  - `/health` -> proxy ke Backend `http://127.0.0.1:3000/health`
  - `/assets/*` -> layani file statis dari `dist/assets/*` dengan header `Cache-Control: public, max-age=31536000, immutable`
  - Seluruh route UI Admin Panel lainnya (`/login`, `/dashboard`, `/fleet`, `/bookings`, `/customers`, `/finance`, `/pricing`, `/messages`, `/content`, `/analytics`, `/settings`) -> **SPA Fallback** ke `dist/index.html` dengan `Cache-Control: no-store`.
- **Routing Same-Origin Public Website:**
  - `/api/v1/public/*` (`GET` katalog/konten/rental-types, `POST /api/v1/public/booking-requests`, dan `POST /api/v1/public/contact-messages`) -> proxy ke Backend `http://127.0.0.1:3000/api/v1/public/*`
  - `/runtime-config.js` dan halaman statis (`index.html`, `pages/*.html`, `css/tailwind.generated.css`, `js/*`, `assets/*`) -> layani dari direktori Public Website.
- **Batas Ukuran Request:** Express membatasi payload JSON maksimum `100kb` (`express.json({ limit: '100kb' })`). Upload file biner belum diaktifkan pada scope saat ini.

---

## 5. Rate Limiting, Health Check, Logging, & Graceful Shutdown

- **Rate Limiting:**
  - `POST /auth/login`: Maksimum 5 percobaan per 15 menit per kombinasi `(IP, identifier)`.
  - `POST /auth/mfa/verify`: Maksimum 3 percobaan per 5 menit per kombinasi `(challengeHash, IP)`.
  - `POST /api/v1/public/booking-requests`: Maksimum 30 permintaan per menit per IP.
  - `POST /api/v1/public/contact-messages`: Pembatasan request per IP pada router kontak publik.
  - *Catatan Multi-Instance:* Implementasi rate limiter saat ini menggunakan penyimpanan in-memory per proses dan bergantung pada `TRUST_PROXY` agar `req.ip` tidak kolaps ke IP reverse proxy. Untuk deployment multi-replica, tambahkan rate limiting pada layer reverse proxy/WAF atau migrasikan store ke Redis.
- **Health Checks:**
  - `GET /health` mengeksekusi `SELECT 1` ke PostgreSQL dan mengembalikan HTTP `200` (`{"status":"ok","timestamp":"...","checks":{"database":"ok"}}`) atau HTTP `503` (`{"status":"unavailable","timestamp":"...","checks":{"database":"unavailable"},"requestId":"..."}`) tanpa membocorkan detail koneksi.
  - `Dockerfile` menyertakan `HEALTHCHECK` periodik ke `/health` dan `/auth/csrf`.
- **Structured Logging & Field Allowlist:**
  - `src/lib/logger.js` menulis JSON terstruktur ke `stdout` dengan allowlist ketat (`level`, `event`, `requestId`, `method`, `statusCode`, `durationMs`, `errorType`), sehingga properti lain di luar allowlist (seperti password, token, secret, atau `DATABASE_URL`) otomatis tidak dicatat.
  - Setiap respons menyertakan header `X-Request-Id` (UUIDv4) untuk korelasi log tanpa membocorkan stack trace atau pesan error database internal pada respons HTTP `500`.
- **Graceful Shutdown:**
  - `src/server.js` menangani sinyal `SIGINT` dan `SIGTERM`, menghentikan penerimaan koneksi baru (`server.close`), memutus koneksi pool Prisma (`await prisma.$disconnect()`), dan memiliki fallback force-close setelah `10_000 ms`.

---

## 6. Prosedur Backup & Restore PostgreSQL

Lihat juga [postgres-backup-restore.md](postgres-backup-restore.md):
1. **Backup:**
   ```sh
   pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="anantalia-$(date -u +%Y%m%dT%H%M%SZ).dump"
   ```
2. **Restore (ke database kosong terpisah untuk verifikasi):**
   ```sh
   pg_restore --exit-on-error --no-owner --no-privileges --dbname="$RESTORE_DATABASE_URL" anantalia-backup.dump
   ```
3. Verifikasi identitas database target, status migrasi (`_prisma_migrations`), jumlah baris tabel, serta `GET /health` sebelum pengalihan trafik.
