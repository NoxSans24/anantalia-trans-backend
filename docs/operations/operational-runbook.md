# Operational Runbook — Anantalia Trans

Dokumen ini berisi prosedur penanganan insiden, monitoring, serta rilis dan rollback operasional untuk ketiga komponen Anantalia Trans (`anantalia-trans-backend`, `anatlia` Public Website, dan `stitch_anantalia_trans_admin_panel` Admin Panel). Seluruh perintah merujuk pada modul, endpoint, dan script aktual pada repository.

---

## 1. Sinyal Observabilitas & Baseline Monitoring

| Komponen | Mekanisme Observabilitas Saat Ini | Target / Ambang Peringatan |
| :--- | :--- | :--- |
| **Backend API (`src/lib/logger.js`)** | Structured JSON log ke `stdout` dengan allowlist field `level`, `event`, `requestId`, `method`, `statusCode`, `durationMs`, `errorType`. Password, secret, token, dan `DATABASE_URL` tidak dicatat. | Event `server_started`, zero error `500`, zero kebocoran secret. |
| **Database Health (`GET /health`)** | Menjalankan `SELECT 1` via Prisma. Mengembalikan HTTP `200` (`{"status":"ok","checks":{"database":"ok"}}`) atau `503` (`{"status":"unavailable","checks":{"database":"unavailable"}}`). | HTTP `200` konsisten; alert bila HTTP `503` > 2 kali beruntun. |
| **Request Traceability** | Header respons `X-Request-Id` (UUIDv4) disisipkan pada setiap HTTP response (`src/app.js`). | Korelasikan keluhan pengguna menggunakan `X-Request-Id` pada log backend. |
| **Container & Runtime (`compose.production.yaml`)** | Service `db` memakai `pg_isready` setiap `10s`; container `api` berjalan sebagai `USER node`, `read_only: true`, `cap_drop: [ALL]`. | Status container `healthy`; CPU/RAM dan pool koneksi PostgreSQL normal. |
| **Audit Jejak (`ActivityLog`)** | Perubahan akun, otorisasi, status booking, konten, dan konfigurasi dicatat di tabel PostgreSQL `ActivityLog`. | Pantau lonjakan gagal login/perubahan hak akses dari dashboard atau SQL read-only. |

> **Keterbatasan Terverifikasi:** Repository belum menyertakan exporter metrik Prometheus/OpenTelemetry maupun integrasi alerting eksternal (PagerDuty/Slack/email). Operator wajib memasang agen log/health probe pada host atau orchestrator sebelum go-live publik.

---

## 2. 8 Skenario Penanganan Insiden & Gangguan

### Skenario 1 — Database PostgreSQL Tidak Tersedia / Putus (`GET /health` -> `503`)
- **Gejala:** `GET /health` mengembalikan HTTP `503` dengan payload `{"status":"unavailable","checks":{"database":"unavailable"}}`; log mencatat `health_check_failed`; permintaan halaman armada/booking publik atau admin gagal.
- **Triage & Diagnosa:**
  1. Periksa status container/layanan database: `docker compose -f compose.production.yaml ps` atau `pg_isready`.
  2. Uji konektivitas port & database dari jaringan privat tanpa menampilkan nilai `DATABASE_URL`.
  3. Periksa kapasitas disk PostgreSQL, lock query aktif (`pg_stat_activity`), atau crash container `db`.
- **Mitigasi & Recovery:**
  1. Restart layanan `db` yang sehat (`docker compose -f compose.production.yaml restart db`) — jangan pernah menghapus volume `postgres-data`.
  2. Jika volume rusak, pulihkan dari dump terakhir ke database target sesuai [postgres-backup-restore.md](postgres-backup-restore.md).
  3. Verifikasi `GET /health` kembali HTTP `200` dan katalog armada publik (`/api/v1/public/vehicle-models`) merespons normal.

### Skenario 2 — Kegagalan Migrasi Schema Saat Release (`prisma migrate deploy` Gagal)
- **Gejala:** Job one-shot `migrate` keluar dengan exit code non-zero atau `prisma migrate status` melaporkan migrasi gagal/tertunda.
- **Triage & Diagnosa:**
  1. **Hentikan cutover** instance `api` versi baru; pertahankan container `api` versi sebelumnya tetap aktif.
  2. Periksa pesan error PostgreSQL pada log job migrasi dan cek tabel `_prisma_migrations` secara read-only.
- **Mitigasi & Rollback:**
  1. Jika migrasi gagal di tengah eksekusi (PostgreSQL menjalankan tiap file migrasi secara transaksional) atau menyebabkan regresi kompatibilitas: pulihkan database dari snapshot/custom-format `pg_dump` pra-rilis ke database bersih atau lakukan restore terkontrol, serta jalankan kembali image/tag `api` versi sebelumnya.
  2. Jalankan `npx prisma migrate status` dan verifikasi `GET /health` sebelum membuka trafik.

### Skenario 3 — Kegagalan Startup Backend (`validateEnv` / Konfigurasi Auth Nonaktif)
- **Gejala:** Proses Node keluar segera saat start (`DATABASE_URL is required`, `TRUST_PROXY must not be true or *`, dll.) atau log mencatat `auth_routes_disabled_invalid_password_config` / `auth_routes_disabled_invalid_csrf_secret`.
- **Triage & Diagnosa:**
  1. Verifikasi keberadaan dan format (bukan nilai rahasianya) variabel wajib: `NODE_ENV`, `DATABASE_URL`, `TRUST_PROXY`, `CSRF_SECRET` (>= 32 bytes `base64url`), `TOTP_ACTIVE_KEY_ID`, `TOTP_KEYRING`, serta keempat variabel `ARGON2_*`.
  2. Pastikan `TRUST_PROXY` bernilai valid (`loopback`, `uniquelocal`, `1`, CIDR tepercaya, atau `false`), bukan `true` atau `*`.
- **Mitigasi:** Perbaiki environment pada secret manager / compose operator, lalu restart service `api` dan pantau event `server_started`.

### Skenario 4 — Admin Terkunci / Rate Limit Login-MFA (`429`) / Perangkat TOTP Hilang
- **Gejala:** Pengguna menerima HTTP `429 RATE_LIMITED` (`Too many login attempts` atau `Too many MFA attempts`), atau perangkat autentikator hilang sehingga `POST /auth/mfa/verify` selalu ditolak (`401`).
- **Triage & Diagnosa:**
  1. Periksa apakah beberapa pengguna berbagi satu bucket rate-limit karena IP kolaps (`req.ip` terbaca `127.0.0.1` akibat salah konfigurasi `TRUST_PROXY` atau header `X-Forwarded-For` hilang dari Nginx/Caddy).
  2. Konfirmasi batas rate limit default (`rate-limit.middleware.js`): login `5 req / 15 menit` per `(IP, identifier)`, MFA `3 req / 5 menit` per `(challengeHash, IP)`.
- **Mitigasi:**
  1. Untuk lockout sementara: tunggu berakhirnya jendela waktu (`5`–`15` menit) dan pastikan reverse proxy meneruskan `X-Forwarded-For` sesuai `TRUST_PROXY`.
  2. Untuk kehilangan perangkat TOTP non-last-admin: `SUPER_ADMIN` lain dapat mencabut/me-reset akun via modul Pengaturan Pengguna.
  3. Untuk kehilangan perangkat `SUPER_ADMIN` aktif terakhir: eskalasi ke prosedur break-glass sesuai persetujuan `Q-AUTH-003` pada [owner-signoff-checklist.md](owner-signoff-checklist.md) (database secara disengaja menolak menonaktifkan/menghapus `SUPER_ADMIN` terakhir).

### Skenario 5 — Kegagalan Cookie Sesi / CSRF (`401 UNAUTHENTICATED`, `403 CSRF_INVALID`, atau Loop Redirect ke `#/login`)
- **Gejala:** Admin Panel selalu kembali ke `#/login` meski kredensial benar, permintaan ke `/api/v1/admin/*` mengembalikan HTTP `401 UNAUTHENTICATED` (sesi kosong/kedaluwarsa/dicabut — hanya kondisi ini yang memicu redirect sesi habis), atau permintaan `POST`/`PATCH`/`DELETE` ditolak HTTP `403` `CSRF_INVALID` / `FORBIDDEN`.
- **Triage & Diagnosa:**
  1. Pada `NODE_ENV=production`, cookie `__session` (`HttpOnly; SameSite=Lax; Secure`) dan `__csrf` (`SameSite=Lax; Secure`) wajib melalui **HTTPS** atau reverse proxy dengan header `X-Forwarded-Proto: https` dan `TRUST_PROXY` yang benar.
  2. Pastikan Admin Panel dan endpoint `/auth/*`, `/api/*` dilayani pada **origin yang sama** (Nginx/Caddy reverse proxy, tanpa cross-domain terpisah yang memblokir cookie).
  3. Pastikan waktu sistem server sinkron (NTP) karena token CSRF bertimestamp TTL 1 jam dan TOTP memakai jendela `30 detik`.
- **Mitigasi:** Perbaiki terminasi TLS & konfigurasi proxy `X-Forwarded-Proto`/`X-Forwarded-For`, lalu minta admin melakukan muat ulang halaman (`Ctrl+Shift+R`) agar cookie `__csrf` diperbarui.

### Skenario 6 — Gangguan Pengiriman Email Balasan Inbox (`smtp_not_configured` / Webhook Gagal)
- **Gejala:** Balasan pesan di modul Pesan Masuk (`#/messages`) tersimpan di PostgreSQL, namun status pengiriman menunjukkan belum terkirim atau menu Kesehatan Sistem menampilkan `Layanan Email (SMTP_WEBHOOK_URL)` berstatus `not_configured`.
- **Triage & Diagnosa:**
  1. Periksa apakah `SMTP_WEBHOOK_URL` sudah disetel di environment server dan diawali `http://` atau `https://`.
  2. Gunakan fitur `Uji Koneksi` di halaman Pengaturan -> Integrasi (`settings.service.js`, timeout 5 detik).
- **Mitigasi:** Selama `SMTP_WEBHOOK_URL` belum tersedia, tim CS tetap menindaklanjuti pelanggan via WhatsApp/telepon dari data yang aman tersimpan di PostgreSQL. Setelah webhook/SMTP tersedia, set `SMTP_WEBHOOK_URL`, restart container `api`, dan verifikasi via tombol `Uji Koneksi`.

### Skenario 7 — Katalog Armada Publik Kosong / Booking Publik Gagal (`502` atau `429`)
- **Gejala:** Halaman `pages/armada.html` menampilkan state kosong atau error `502`, atau submit booking publik gagal.
- **Triage & Diagnosa:**
  1. Uji `GET /api/v1/public/vehicle-categories?rentalType=with_driver` dan `GET /api/v1/public/vehicle-models?categoryId=<uuid>&rentalType=with_driver` melalui origin publik serta langsung ke backend `/health` (catatan: memanggil `/vehicle-models` tanpa `categoryId` & `rentalType` memang sengaja mengembalikan `400 INVALID_INPUT` sesuai kontrak OpenAPI).
  2. Jika API mengembalikan daftar kosong (`items: []`), periksa apakah model armada sudah berstatus `isVerified = true`, `isActive = true`, dan minimal satu `VehicleRentalOption` (`with_driver`/`self_drive`) berstatus `isEnabled = true` di database produksi.
  3. Jika respons `429 RATE_LIMITED`, batas 30 permintaan booking/menit/IP terlampaui (atau `TRUST_PROXY` salah konfigurasi sehingga semua pengunjung berbagi 1 IP).
- **Mitigasi:** Pulihkan upstream backend / perbaiki konfigurasi proxy `TRUST_PROXY`, atau verifikasi & aktifkan model armada terverifikasi melalui Admin Panel (`#/fleet`).

### Skenario 8 — Indikasi Kebocoran Kredensial / Rotasi Kunci (`CSRF_SECRET` & `TOTP_KEYRING`)
- **Gejala:** Terindikasi kebocoran secret environment, akun admin dicurigai dikompromikan, atau rotasi berkala terjadwal.
- **Langkah Penanganan:**
  1. **Revoke Sesi & Akun:** Nonaktifkan akun/sesi mencurigakan dari Admin Panel (`#/settings`) atau revoke baris `AdminSession` di PostgreSQL.
  2. **Rotasi `CSRF_SECRET`:** Hasilkan secret acak minimal 32 bytes `base64url`, perbarui di secret manager, lalu restart `api` (seluruh pengguna akan otomatis memperoleh cookie `__csrf` baru pada request berikutnya).
  3. **Rotasi `TOTP_KEYRING` (Zero-Downtime Key ID):** Tambahkan key baru (`k2`) ke JSON `TOTP_KEYRING` sementara key lama (`k1`) **tetap dipertahankan** dalam JSON `TOTP_KEYRING` agar `totpFactorService` tetap bisa mendekripsi faktor TOTP yang sudah terdaftar, lalu ubah `TOTP_ACTIVE_KEY_ID=k2` dan restart `api`.
  4. **Rotasi Password DB:** Buat/ubah kredensial role database non-migration dan perbarui `DATABASE_URL` di secret manager saat maintenance window singkat.

---

## 3. Prosedur Release & Rollback Standar

### Urutan Release Terkontrol (Maintenance Window)
1. **Pre-Flight & Snapshot Pra-Rilis:**
   - Jalankan pre-check migrasi (`npx prisma migrate status`) dan ambil `pg_dump` custom-format sebelum perubahan apa pun.
   - Uji `pg_restore --list` pada arsip dump.
2. **Migrasi Skema (Jika Ada):**
   - Jalankan `docker compose -f compose.production.yaml --profile migration run --rm migrate` (hanya `prisma migrate deploy`).
3. **Deploy Asset & Backend:**
   - Deploy bundle statis baru (`dist/` Admin Panel dan situs statis `anatlia` + `css/tailwind.generated.css`).
   - Rollout instance `api` baru (`NODE_ENV=production`) dan verifikasi `GET /health` -> HTTP `200`, `GET /auth/csrf` -> HTTP `200`, serta halaman publik/admin termuat tanpa error HTTP `4xx`/`5xx`.
4. **Post-Deploy Verification:**
   - Cek log terstruktur `server_started` dan uji 1 siklus baca katalog publik + login MFA admin.

### Urutan Rollback (< 5 Menit untuk Aplikasi / Terkendali untuk DB)
1. **Rollback Aplikasi Only (Tanpa Perubahan Skema DB Irreversibel):**
   - Arahkan reverse proxy / jalankan kembali container tag `api` dan folder aset statis rilis sebelumnya.
   - Verifikasi `GET /health` -> `200` dan smoke-test endpoint publik/admin.
2. **Rollback Aplikasi + Database (Bila Migrasi Merusak Data/Kompatibilitas):**
   - Hentikan sementara trafik ke backend (mode pemeliharaan pada reverse proxy agar tidak terjadi tulis parsial).
   - Pulihkan snapshot pra-rilis ke database tujuan sesuai [postgres-backup-restore.md](postgres-backup-restore.md) dan verifikasi jumlah baris serta `_prisma_migrations`.
   - Nyalakan container `api` versi sebelumnya dan aset frontend sebelumnya, verifikasi `GET /health` -> `200`, lalu buka kembali trafik.
