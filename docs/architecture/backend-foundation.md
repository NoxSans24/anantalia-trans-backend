# Backend Foundation

## Tujuan dan batas

Backend Anantalia Trans adalah layanan sisi server yang direncanakan untuk mendukung produk digital perusahaan. Backend dan Frontend berada di repository terpisah. Dokumen ini menjelaskan baseline keputusan dan arah arsitektur; dokumen ini bukan spesifikasi lengkap atau bukti bahwa aplikasi tersedia.

Gunakan status secara terpisah untuk setiap keputusan dan kemampuan:

- **APPROVED**: keputusan owner disetujui untuk cakupan yang disebutkan.
- **PROPOSED**: arah teknis yang direkomendasikan, belum menjadi keputusan implementasi.
- **PENDING**: rincian atau keputusan belum tersedia.
- **NOT IMPLEMENTED**: belum diterapkan dalam aplikasi.
- **NOT TESTED**: belum ada bukti pengujian untuk lingkup tersebut.
- **PARTIALLY VALIDATED**: sebagian bukti terbatas tersedia; cakupan sisanya tetap terbuka.
- **BLOCKED**: pekerjaan atau aktivasi tertentu menunggu keputusan, prasyarat, atau bukti yang disebutkan.

Satu area dapat memiliki beberapa status sekaligus. Approval keputusan tidak menyatakan fitur telah diimplementasikan, diuji, atau siap produksi.

## Ownership, repository, dan stack

### APPROVED — keputusan owner

- Backend dimiliki Tim Anantalia Trans; maintainer Muhammad Ihsan Hanafi.
- Backend dan Frontend menggunakan repository terpisah.
- Nama repository Backend: `NoxSans24/anantalia-trans-backend`; hosting/management menggunakan akun GitHub repository Frontend.
- Stack: Node.js 26.x, JavaScript, Express 5.x, npm, PostgreSQL 18, Prisma 7.x, Prisma Migrate.

### Status repository saat ini

Repository ini telah dibuat, branch aktif `main`, dan initial commit telah di-push. Pernyataan historis bahwa repository belum dibuat atau pembuatannya belum diizinkan telah **superseded** oleh kronologi tersebut. Tanggal, bukti, dan rincian otorisasi pembuatan tidak ditambahkan karena tidak tercatat dalam sumber yang tersedia. Status ini tidak memberi izin untuk mengubah remote, branch, commit, atau konfigurasi Git.

### Validasi teknologi

- Pilihan stack: **APPROVED**.
- Fixture Express/Node.js/npm: **PARTIALLY VALIDATED** menurut bukti T4.3.1.1 yang dirujuk oleh dokumen T4.2/T4.3.
- Prisma/PostgreSQL/Migrate: **PARTIALLY VALIDATED**; T4.3.2 tetap berstatus **PARTIALLY COMPLETED**. Hasil fixture tertentu dilaporkan lulus dan tidak diulang pada audit terakhir.
- Local Express bootstrap: **IMPLEMENTED**; unit tests 8/8 **PASS**; startup, health HTTP 200, dan Ctrl+C shutdown **PASS** pada Node 26.13.0.
- Prisma/PostgreSQL development integration: **PASS** pada PostgreSQL 18 dan database kosong `anantalia_backend_dev`; production integration tetap **NOT TESTED**.
- Business API dan database produksi: **NOT IMPLEMENTED**, **NOT TESTED**.

## Arah arsitektur aplikasi

### PROPOSED — belum diimplementasikan

- Mulai dengan satu aplikasi modular. Kelompokkan kode berdasarkan domain yang sudah dikonfirmasi.
- Pisahkan tanggung jawab transport/HTTP, application/domain services, akses data, dan adapter integrasi.
- Public API dan Admin API memiliki pipeline serta kebijakan terpisah. Public tidak memerlukan sesi Admin. Admin memerlukan autentikasi dan otorisasi server-side untuk setiap operasi.
- Middleware menangani batas transport seperti request ID, parsing, validasi, session/CSRF bila relevan, dan error mapping. Urutan serta kontrak middleware belum divalidasi pada aplikasi Backend.
- Validasi input dilakukan pada trust boundary. Error untuk client tidak membocorkan stack, SQL, credential, atau data sensitif.
- Tidak ada akses database langsung dari browser. Response publik menggunakan allowlist data yang memang disetujui untuk publik.

Detail modul, route, DTO, permission identifier, error envelope, framework middleware, dan kontrak API per fitur perlu dibekukan secara bertahap. Nama route atau contoh API dari dokumen sumber tetap berstatus kontrak target kecuali dinyatakan secara eksplisit sebagai keputusan.

## Identitas, authentication, dan RBAC

### APPROVED — keputusan scoped

- Intent awal mencakup self-hosted dan OIDC. Self-hosted mengharuskan setiap akun memiliki email dan username; login menerima salah satunya. Registrasi publik tidak tersedia.
- MFA diwajibkan untuk semua role; platform passkeys dan security keys diterima.
- NIST SP 800-63B-4 (2025) dipilih sebagai password baseline. Ini bukan klaim compliance.
- Sesi non-persisten dipilih; kebijakan rate-limit login dan password reset dipisah.
- OWN-009 menyetujui matriks grant enam aksi untuk sepuluh modul. Batas Manage Users terpisah dan hanya SUPER_ADMIN mengelola akun ADMIN/STAFF.
- Q-RBAC-011 menyetujui batas field akun dan pemisahan My Profile secara scoped. Q-RBAC-012 menyetujui perlindungan SUPER_ADMIN aktif terakhir. Q-RBAC-013 menyetujui perubahan mapping melalui konfigurasi/seed yang ditinjau serta katalog role/permission read-only.

### PENDING

OIDC provider/issuer/claims/linking; normalisasi identifier; enrollment dan recovery MFA; TTL/idle/max session dan revoke events; rate-limit threshold; password applicability owner; email provider, token expiry dan initiator; authority/workflow break-glass; pembaca katalog role/permission; detail My Profile API; serta aturan field/workflow per domain belum lengkap. Lihat [decision reconciliation](decision-reconciliation.md).

### NOT IMPLEMENTED / NOT TESTED

Belum ada login, session, MFA, OIDC, authentication, authorization, permission engine, account API, atau audit runtime. Matriks grant dan invariant bukan bukti implementasi atau negative authorization test.

## Database, transaksi, dan migration

### APPROVED

- PostgreSQL 18, Prisma 7.x, dan Prisma Migrate.
- DB-001: pilihan owner adalah `content_key` unik secara global.
- DB-002: pilihan owner adalah composite foreign key untuk invariant kategori/model.

### PROPOSED

Tinjau dan version-kan perubahan schema lewat migration. Gunakan constraint database bersama validasi aplikasi; tentukan batas transaksi pada use case yang memerlukan konsistensi. Desain target menyebut booking, initial status history, dan audit sebagai satu unit persistensi sebelum respons sukses.

### PENDING / NOT TESTED

Schema final, DDL DB-001/DB-002, locale/content lifecycle, snapshot dan recategorization behavior, semantik uniqueness identity eksternal, transaction coverage domain, migration failure/repair/drift, backup policy, retention, RPO/RTO, dan recovery ownership belum ditetapkan atau divalidasi penuh. Tidak ada schema atau migration di repository ini.

## Configuration, logging, security, dan testing

### PROPOSED

- Simpan konfigurasi per environment di luar source. Validasi konfigurasi wajib saat startup.
- Rahasia tidak boleh masuk repository public, log, URL, atau response. Gunakan sumber secret yang disetujui saat dipilih.
- Gunakan log terstruktur yang diminimalkan dan satu alur audit yang dapat ditinjau; jangan log password, token mentah, cookie/session secret, atau payload credential.
- Terapkan security by default: deny-by-default untuk grant yang tidak disetujui, query terparameterisasi, batas request yang jelas, allowlist input/output, dan kontrol CSRF untuk mutasi berbasis cookie setelah topology ditentukan.
- Gunakan unit, integration, contract, authorization, security, migration/recovery, dan browser tests sesuai risiko dengan data sintetis.

### PENDING / NOT TESTED

Nama variabel environment untuk kontrol operasional, secret manager, logging provider/event catalog/retensi, role pembaca, monitoring, alert, readiness contract, CI platform, cakupan test penuh, dan operator masih PENDING. Bootstrap memiliki validasi environment dasar, safe structured logs dan unit test; kontrol operasi penuh dan test suite menyeluruh NOT IMPLEMENTED / NOT TESTED.

## Prinsip domain yang telah diputuskan

- Booking awal berstatus `waiting_confirmation`, bukan reservasi terkonfirmasi. Request harus tersimpan sebelum handoff.
- Handoff WhatsApp manual; link aktif memerlukan nomor bisnis resmi yang diverifikasi. Klik/link bukan bukti aplikasi terbuka atau pesan terkirim.
- Kategori, model, opsi rental per model, dan unit fisik adalah konsep berbeda.
- Data dummy/prototipe tidak menjadi data operasional tanpa sumber dan persetujuan yang sesuai.
- Pricing tidak menjadi prasyarat booking request pada baseline saat ini.

## Ringkasan status

| Area | Status |
|---|---|
| Stack dan ownership | APPROVED |
| Repository dibuat, `main`, initial commit di-push | Status saat ini; kronologi tanpa tanggal/bukti otorisasi tambahan |
| Struktur modular, pemisahan API, layer dan validation/error handling | PROPOSED; NOT IMPLEMENTED |
| OWN-009 dan batas akun | APPROVED; detail domain tertentu PENDING; implementasi dan tes NOT IMPLEMENTED/NOT TESTED |
| DB-001/DB-002 | APPROVED; DDL/schema validation PENDING/NOT TESTED |
| Fixture teknologi T4.3 | PARTIALLY VALIDATED; T4.3.2 PARTIALLY COMPLETED |
| Express bootstrap, `/health`, safe error handling, environment validation | IMPLEMENTED; 8/8 unit tests PASS; Node 26 startup, HTTP health, Ctrl+C shutdown PASS |
| Prisma Client generation/configuration | IMPLEMENTED; generate/validate PASS; PostgreSQL 18 development integration PASS |
| Business API, database production, auth, CI/CD, deployment | NOT IMPLEMENTED; NOT TESTED |
| Auth operasional, aturan fitur dan operasi produksi | PENDING; fitur terkait BLOCKED dari aktivasi produksi |

Lihat [Decision Reconciliation](decision-reconciliation.md) untuk keputusan dan konflik sumber, serta [Implementation Readiness](implementation-readiness.md) untuk blocker dan urutan kerja.

## Bootstrap implementation boundary

The initial local bootstrap adds Express application/server modules, required environment validation, loopback default binding, a 100 KB JSON body limit, request IDs, allowlisted structured logs, centralized safe errors, not-found handling, graceful shutdown, and `GET /health` using `SELECT 1`. The Prisma 7 PostgreSQL adapter and an empty PostgreSQL schema are configured; there are no business models or migrations. T4.6.1 validated Node 26.13.0 startup, 8/8 unit tests, Prisma validate/generate, one database integration health test, and Ctrl+C shutdown against local PostgreSQL 18 database `anantalia_backend_dev`. The legacy `backend_validation` database was not used or changed. These results cover local development only and do not imply production readiness.
