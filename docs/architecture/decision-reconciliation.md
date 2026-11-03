# Backend Decision Reconciliation

## Tujuan dan otoritas sumber

Dokumen ini menyelaraskan keputusan Admin Panel yang tercatat dengan baseline Backend. Sumber Admin Panel bersifat read-only untuk rekonsiliasi ini. Keputusan owner berlaku hanya pada cakupan yang disebutkan; status APPROVED tidak menyatakan implementasi atau validasi selesai.

Status yang dipakai: **APPROVED**, **PROPOSED**, **PENDING**, **NOT IMPLEMENTED**, **NOT TESTED**, **PARTIALLY VALIDATED**, dan **BLOCKED**. Status dapat berlaku bersamaan pada satu area.

Sumber utama: `docs/backend-foundation/t4.2/t4.2-decision-register.md` (register keputusan owner); `docs/backend/decision-log.md`; `docs/backend/business-confirmation-questions.md`; `docs/backend-foundation/t4.2/t4.2-owner-confirmation-checklist.md`; `docs/implementation-plan.md`; `docs/technical-design/technical-design.md`; `docs/technical-design/t3.3-technical-design-review.md`; `docs/api-specification.md`; serta ringkasan dan bukti T4.3.1/T4.3.2 di Admin Panel.

## OWN-003 — ownership dan repository

| Pernyataan | Status | Rekonsiliasi |
|---|---|---|
| Backend milik Tim Anantalia Trans; maintainer Muhammad Ihsan Hanafi; nama `NoxSans24/anantalia-trans-backend`; hosting/management melalui akun GitHub repository Frontend | APPROVED | Keputusan owner OWN-003 tercatat lengkap di T4.2 Decision Register dan Decision Log. |
| Backend dan Frontend merupakan project/repository terpisah | APPROVED | Pertahankan pemisahan tersebut. |
| Kondisi repository Backend saat ini | Status saat ini | Repository telah dibuat; branch `main`; initial commit telah di-push. Status ini mengikuti kronologi yang diberikan untuk rekonsiliasi ini. |
| Catatan lama “NOT CREATED” / “creation not authorized” | SUPERSEDED | Catatan tersebut menggambarkan keadaan terdahulu dan tidak lagi mendeskripsikan repository saat ini. Jangan mengarang tanggal perubahan atau bukti otorisasi yang tidak tersedia. |
| Rincian tanggal dan bukti otorisasi pembuatan | PENDING / tidak tercatat | Tidak dapat ditetapkan dari dokumen yang tersedia. Tidak mengubah Git atau menyimpulkan siapa/kapankah tindakan dilakukan. |

T4.2 Owner Confirmation Checklist §B masih memuat OWN-003 sebagai PENDING, sedangkan §C dan dokumen T4.2/T4.5 lain mencatat keputusan ownership telah APPROVED. Status historis §B itu superseded untuk keputusan ownership; kronologi repository yang dibuat dan initial commit di-push adalah fakta status yang diberikan, terpisah dari approval scope OWN-003.

## OWN-009 — matriks grant enam aksi

OWN-009 **APPROVED** untuk matriks berikut. Urutan role pada sumber adalah SUPER_ADMIN, ADMIN, STAFF. Matriks bukan bukti permission engine, route, UI, atau test telah tersedia.

| Modul | SUPER_ADMIN | ADMIN | STAFF |
|---|---|---|---|
| Dashboard | Read, Export | Read | Read |
| Data Pelanggan | Semua enam aksi | Read, Create, Update, Delete/deactivate, Export | Read |
| Pemesanan Kendaraan | Semua enam aksi | Semua enam aksi | Read, Update, Verify/approve |
| Manajemen Armada | Semua enam aksi | Semua enam aksi | Read |
| Harga Tarif | Semua enam aksi | Semua enam aksi | Tidak ada grant |
| Analytics Armada | Read, Export | Read, Export | Read |
| Laporan Keuangan | Semua enam aksi | Semua enam aksi | Tidak ada grant |
| Pesan Masuk | Semua enam aksi | Semua enam aksi | Read, Update |
| Konten Website | Semua enam aksi | Semua enam aksi | Read |
| Pengaturan Sistem & Profil | Semua enam aksi | Read, Update | Read, Update |

Enam aksi: Read, Create, Update, Delete/deactivate, Verify/approve, Export. Grant yang tidak terdapat dalam matriks harus tetap deny-by-default sampai ada keputusan baru. Izin granular terhadap field PII, workflow status, publikasi, ekspor, dan aturan domain terpisah tetap **PENDING**.

## Q-RBAC-011–013

| ID | Keputusan | Status tersisa |
|---|---|---|
| Q-RBAC-011 | APPROVED secara scoped: SUPER_ADMIN mengelola field akun ADMIN/STAFF yang disepakati; email dan username wajib, unik/tervalidasi, perubahan email perlu verifikasi sebelum aktif; perubahan password lewat alur khusus dan perubahan sensitif diaudit. My Profile terpisah dan tidak dapat mengubah role/status sendiri. | Normalisasi, detail validasi, verifikasi, kontrak/API, audit runtime dan pengujian **PENDING / NOT IMPLEMENTED / NOT TESTED**. |
| Q-RBAC-012 | Perlindungan semua operasi yang menghilangkan otoritas SUPER_ADMIN aktif terakhir disetujui, termasuk deactivation, deletion, demotion, suspension atau ekuivalen, dengan enforcement server-side. Break-glass mensyaratkan verifikasi independen, audit dan review. | Identitas recovery authority dan alur approval/execution **PENDING**. Invariant concurrency enforcement **NOT IMPLEMENTED / NOT TESTED**. Break-glass **BLOCKED** sampai owner menetapkan authority dan workflow. |
| Q-RBAC-013 | Mapping role-permission diubah melalui konfigurasi/seed version-controlled yang direview, disetujui, lalu di-deploy; tidak ada UI grant management; katalog role/permission read-only. | Siapa yang boleh membaca katalog dan kontrak API-nya **PENDING**. Kontrol governance, API, dan tes **NOT IMPLEMENTED / NOT TESTED**. |

## Authentication dan security

| Area | APPROVED | PENDING / NOT IMPLEMENTED / NOT TESTED |
|---|---|---|
| Mode identity | Intent self-hosted dan OIDC pada scope awal. | Provider/issuer/claims OIDC, linking, callback/protocol dan uniqueness subject masih PENDING; jangan membekukan schema identity eksternal. |
| Self-hosted login | Akun wajib memiliki email dan username; login menerima salah satu; registrasi publik tidak ada. | Normalisasi, case-folding dan uniqueness detail PENDING; login runtime NOT IMPLEMENTED/NOT TESTED. |
| Password dan token | NIST SP 800-63B-4 (2025) sebagai baseline; token setup/reset sekali pakai, random kuat, simpan hash, tolak token kedaluwarsa/terpakai, jangan log nilai mentah. | Policy owner/applicability review, provider, expiry, initiator, dan implementasi PENDING/NOT TESTED. |
| MFA | Wajib untuk semua role; platform passkeys dan security keys diterima. | Enrollment, fallback, lost-device verifier/procedure dan recovery PENDING; MFA NOT IMPLEMENTED/NOT TESTED. |
| Session | Sesi non-persisten. | Absolute/idle TTL, max sessions, revoke events, cookie/origin/CORS/CSRF topology PENDING; session runtime NOT IMPLEMENTED/NOT TESTED. |
| Rate limiting | Login dan password-reset adalah kebijakan terpisah. | Scope akun/IP, window, threshold, delay/lock/unlock PENDING; kontrol NOT IMPLEMENTED/NOT TESTED. |
| Account recovery | Safeguard verifikasi independen dan audit untuk pemulihan Super Admin disetujui sebagai persyaratan. | Authority dan workflow Q-RBAC-012/Q-AUTH-003, juga email provider/expiry/inisiator AUTH-005, PENDING. Recovery BLOCKED sampai prasyarat owner disepakati. |

Approval di atas tidak mengesahkan klaim compliance, kesiapan produksi, atau pemilihan provider.

## Database decisions

| ID | Keputusan | Status teknis |
|---|---|---|
| DB-001 / OWN-012 | `content_key` harus unik secara global — APPROVED. | DDL dan interaksi dengan route locale/content lifecycle perlu rekonsiliasi; schema validation PENDING/NOT TESTED. Jangan memilih strategi locale sendiri. |
| DB-002 / OWN-013 | Composite foreign key untuk invariant category/model — APPROVED. | Struktur key, booking snapshot, recategorization dan DDL PENDING/NOT TESTED. Jangan mengganti dengan service-only rule. |
| External identity uniqueness / TD33-004 | Tidak ada constraint baru disetujui oleh audit. | Sumber database memakai `auth_provider_subject UNIQUE`, sedangkan kandidat T3.2 memakai pasangan `(auth_provider, auth_provider_subject)`. Semantik provider/issuer belum ditentukan; konflik tetap PENDING hingga keputusan dan review schema. |

Prisma 7.x dan Prisma Migrate serta PostgreSQL 18 tetap menjadi pilihan APPROVED. Schema/migration produksi **NOT IMPLEMENTED**. T4.3.2 **PARTIALLY COMPLETED**; fixture validation **PARTIALLY VALIDATED**, terbatas, sebagian hasil **REPORTED PASS** dan **NOT RE-RUN**.

## API target contract vs runtime

- `/api/v1` dan route/payload pada API Specification adalah **PROPOSED / target contract**, bukan endpoint runtime. Tidak ada endpoint yang diimplementasikan.
- Konvensi umum menyebut prefix `/api/v1`, sedangkan beberapa tabel menulis path relatif `/admin/...`. Penormalan path dan kontrak setiap route masih **PENDING** sebelum freeze.
- Public/Admin pipeline, server-side authorization, safe DTO, error mapping, validasi, pagination dan transaction boundaries adalah arah/requirement desain. Runtime dan tests **NOT IMPLEMENTED / NOT TESTED**.
- OWN-009 menyetujui grant tingkat modul; ia tidak otomatis menyetujui permission identifier spesifik, seluruh payload/API, akses field, atau pembaca katalog role/permission.
- Customer, pricing, finance, messages, analytics, content, settings, My Profile dan sejumlah kontrak Admin tetap parsial/kandidat. Jangan membuat asumsi endpoint atau business rule.

## Konflik dan dokumentasi yang superseded

1. **OWN-003 repository state:** catatan T4.2/T4.3 bahwa repo belum dibuat/pembuatan belum diizinkan adalah historis dan superseded oleh keadaan repository saat ini (branch `main`, initial commit pushed). Tanggal/bukti otorisasi tidak tersedia dan tetap PENDING.
2. **OWN-003 checklist:** Owner Confirmation Checklist §B mempertahankan status PENDING lama, berlawanan dengan keputusan OWN-003 yang kemudian lengkap di register dan §C. Status §B superseded untuk approval ownership.
3. **RBAC foundation text:** backend-foundation lama menggolongkan role/permission seluruhnya sebagai pending. Itu superseded oleh approval OWN-009 dan batas akun terkait. Granular rules, runtime dan tests masih pending/tidak dilakukan.
4. **Identity uniqueness:** TD33-004 masih unresolved; jangan memilih constraint sebelum provider/issuer semantics disepakati.
5. **DB-001/DB-002:** pilihan owner telah disetujui; sumber technical design lama yang menyebut pilihan tersebut unresolved superseded hanya untuk keputusan. DDL/schema validation tetap pending.

## Referensi sumber

- T4.2: `docs/backend-foundation/t4.2/t4.2-decision-register.md`; `docs/backend/decision-log.md`; `docs/backend/business-confirmation-questions.md`; `docs/backend-foundation/t4.2/t4.2-owner-confirmation-checklist.md`; `docs/backend-foundation/t4.2/t4.2-technical-validation-plan.md`; `docs/backend-foundation/t4.2/t4.2-decision-review.md`.
- Rencana/desain: `docs/implementation-plan.md`; `docs/technical-design/technical-design.md`; `docs/technical-design/t3.3-technical-design-review.md`; `docs/api-specification.md`.
- Evidence: `docs/backend-foundation/t4.3/t4.3.1-validation-summary.md`; T4.3.2 validation summary, test evidence, dan backup/recovery validation.
- Backend: [Backend Foundation](backend-foundation.md) dan [Implementation Readiness](implementation-readiness.md).
