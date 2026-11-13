# Backend Foundation

## Tujuan dan batas

Backend Anantalia Trans adalah layanan sisi server yang direncanakan untuk mendukung produk digital perusahaan. Backend dan Frontend berada di repository terpisah. Dokumen ini menjelaskan baseline keputusan dan arah arsitektur; dokumen ini bukan spesifikasi lengkap atau bukti bahwa aplikasi tersedia.

**Status snapshot source 5 November 2026:** bagian planning di bawah merekam keputusan dan keadaan historis. Source kini juga berisi autentikasi lokal dengan MFA/TOTP, session management, auth/admin/profile HTTP routes, RBAC authorization checks, activity logging, dan migration safety. Current verification scope dan blocker tercatat pada [Implementation Readiness](implementation-readiness.md); status tersebut mengesampingkan klaim runtime lama di dokumen ini. Business APIs, OIDC, MFA enrollment/recovery, disposable database integration, dan production readiness tetap incomplete.

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
- Sesi administrator opaque dan persisten di PostgreSQL; token entropy minimal 256 bit, hanya hash token disimpan, idle limit 30 menit, maksimum absolut 8 jam, dan sesi dapat dicabut individual atau per pengguna. Kebijakan rate-limit login dan password reset dipisah.
- Fondasi User administrator: UUID, email/username wajib unik dan dinormalisasi trim+lowercase, display name opsional, password hash nullable, status ACTIVE/SUSPENDED/DISABLED, soft delete, dan timestamps.
- Role-permission many-to-many; SUPER_ADMIN eksklusif per akun. Mapping grant melalui konfigurasi/seed yang direview, bukan UI. Identitas OIDC unik pada pasangan issuer+subject; akun tidak ditautkan otomatis hanya berdasarkan email.
- OWN-009 menyetujui matriks grant enam aksi untuk sepuluh modul. Batas Manage Users terpisah dan hanya SUPER_ADMIN mengelola akun ADMIN/STAFF.
- Q-RBAC-011 menyetujui batas field akun dan pemisahan My Profile secara scoped. Q-RBAC-012 menyetujui perlindungan SUPER_ADMIN aktif terakhir. Q-RBAC-013 menyetujui perubahan mapping melalui konfigurasi/seed yang ditinjau serta katalog role/permission read-only.

### PENDING

OIDC provider/issuer/claims/linking configuration; enrollment dan recovery MFA; rate-limit threshold; password applicability owner; Argon2id parameters; cookie/CSRF policy; email provider, token expiry dan initiator; authority/workflow break-glass; pembaca katalog role/permission; granular permission identifiers; detail My Profile API; serta aturan field/workflow per domain belum lengkap. Lihat [decision reconciliation](decision-reconciliation.md).

### Implementasi source terkini — status terpisah

Login credential + MFA/TOTP completion, session creation/validation/rotation/revocation, CSRF, authorization service, reviewed role grant seed function, admin-account/profile routes, account lifecycle, and activity logging are implemented in source. Unit and HTTP-level tests use injected dependencies. OIDC protocol, MFA enrollment/recovery endpoints, first-admin onboarding, email verification, complete production configuration, and database-backed integration verification remain incomplete. Permission approval and source presence are not equivalent to production readiness.

## Database, transaksi, dan migration

### APPROVED

- PostgreSQL 18, Prisma 7.x, dan Prisma Migrate.
- DB-001: pilihan owner adalah `content_key` unik secara global.
- DB-002: pilihan owner adalah composite foreign key untuk invariant kategori/model.

### PROPOSED

Tinjau dan version-kan perubahan schema lewat migration. Gunakan constraint database bersama validasi aplikasi; tentukan batas transaksi pada use case yang memerlukan konsistensi. Desain target menyebut booking, initial status history, dan audit sebagai satu unit persistensi sebelum respons sukses.

### IMPLEMENTED / VALIDATED TERBATAS

Migration `20261103200256_auth_identity_session_foundation` membuat tabel dan constraint foundation di database development `anantalia_backend_dev`; tidak ada seed atau data bisnis. Prisma 7.10.1 validate/generate PASS, migration deploy/status up to date, unit tests 16/16 PASS, dan integration tests 2/2 PASS. Test katalog memverifikasi object/constraint terpasang tanpa menulis data; tes tersebut tidak membuktikan alur login/session atau perilaku constraint melalui operasi data.

### PENDING / NOT TESTED

Schema domain final, DDL DB-001/DB-002, locale/content lifecycle, snapshot dan recategorization behavior, transaction coverage domain, migration failure/repair/drift, backup policy, retention, RPO/RTO, dan recovery ownership belum ditetapkan atau divalidasi penuh. Auth foundation development bukan schema produksi.

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
| Struktur modular, pemisahan API, layer dan validation/error handling | Modular auth/admin/profile source dan centralized safe errors tersedia; public/admin domain separation dan full schema validation masih incomplete |
| Auth/RBAC data foundation | Auth/MFA/session/account/profile runtime dan seed function tersedia; current unit/HTTP tests pass; database-backed runtime tests belum diverifikasi ulang |
| OWN-009 dan batas akun | APPROVED; account role grants, admin lifecycle and permission enforcement implemented with unit coverage; invitation, granular PII and operational MFA recovery pending |
| DB-001/DB-002 | APPROVED; DDL/schema validation PENDING/NOT TESTED |
| Fixture teknologi T4.3 | PARTIALLY VALIDATED; T4.3.2 PARTIALLY COMPLETED |
| Express bootstrap, `/health`, safe error handling, environment validation | IMPLEMENTED; latest unit suite and HTTP-level tests verified in current continuation report; historical startup/shutdown evidence remains scoped to its earlier run |
| Prisma Client generation/configuration | IMPLEMENTED; latest generate/validate PASS; PostgreSQL development integration is historical evidence, not re-run in current continuation |
| Business API, production database, CI/CD, deployment | NOT IMPLEMENTED / NOT TESTED; business modules remain blocked by owner-confirmation questions |
| Auth operasional, aturan fitur dan operasi produksi | PENDING; fitur terkait BLOCKED dari aktivasi produksi |

Lihat [Decision Reconciliation](decision-reconciliation.md) untuk keputusan dan konflik sumber, serta [Implementation Readiness](implementation-readiness.md) untuk blocker dan urutan kerja.

## Bootstrap implementation boundary

The initial bootstrap history added Express application/server modules, environment validation, loopback default binding, request IDs, structured allowlisted logs, centralized safe errors, graceful shutdown, and `GET /health`. Current app also sets `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy`. See the current snapshot in Implementation Readiness for present schema, auth routes, test results, and outstanding runtime/production validation; historical T4.6/T4.7 evidence is not a substitute for latest test evidence.
