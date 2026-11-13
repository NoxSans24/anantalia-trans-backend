# Owner Sign-Off Checklist — Anantalia Trans

**Status:** Dokumen siap tanda tangan pemilik bisnis (`PENDING_OWNER_CONFIRMATION`)  
**Cakupan:** Hanya memuat keputusan bisnis yang **masih belum terjawab** pada Decision Register / Business Confirmation Questions. Keputusan yang telah final/disetujui (`OWN-001` s/d `OWN-010`, `OWN-012`, `OWN-013`, `Q-RBAC-001` s/d `Q-RBAC-011`, `Q-RBAC-013`) **tidak diulang** dalam tabel pertanyaan terbuka di bawah.

---

## Ringkasan Keputusan yang Sudah Final (`APPROVED` — Tidak Ditanyakan Ulang)

| Decision ID | Ringkasan Keputusan Final | Status |
|---|---|---|
| `OWN-001` .. `OWN-008` | Stack teknis (Node.js + Express + Prisma 7 + PostgreSQL), pemisahan 3 workspace, baseline password NIST SP 800-63B-4, kewajiban MFA untuk semua role, sesi opaque hash-only non-persisten. | `APPROVED` |
| `OWN-009` (`Q-RBAC-001`..`010`) | Matriks 6 aksi (`VIEW`, `CREATE`, `UPDATE`, `DELETE`, `APPROVE`, `EXPORT`) untuk `SUPER_ADMIN`, `ADMIN`, dan `STAFF` pada 10 modul Admin Panel. | `APPROVED` |
| `Q-RBAC-011`, `Q-RBAC-013` | Pengelolaan akun oleh `SUPER_ADMIN`, normalisasi email/username (`trim` + `lowercase`), pemisahan My Profile, dan perubahan grant hanya melalui seed/config ter-review. | `APPROVED` |
| `DB-001` (`OWN-012`), `DB-002` (`OWN-013`), `TD33-004` | Keunikan global `contentKey`, relasi kategori-model armada, dan keunikan identitas eksternal `(issuer, subject)` tanpa auto-link email. | `APPROVED` |

---

## Daftar Keputusan Terbuka yang Membutuhkan Konfirmasi Owner (`PENDING_OWNER_CONFIRMATION`)

### 1. Authentication, Security & Recovery

| Decision ID | Pertanyaan Spesifik untuk Pemilik Bisnis | Format Jawaban / Pilihan yang Tersedia | Dampak Teknis & Operasional Jika Belum Diputuskan | Fitur yang Tetap Dinonaktifkan / Fail-Closed Sementara Menunggu | Status |
|---|---|---|---|---|---|
| `Q-AUTH-001` / `Q-AUTH-002` | Provider/issuer OIDC mana yang akan digunakan pada produksi (jika OIDC diaktifkan selain login lokal), siapa operator tenant-nya, dan klaim apa yang diizinkan untuk provisioning akun? | **Opsi A:** Tunda OIDC untuk rilis awal (hanya gunakan Self-Hosted Login + TOTP MFA).<br>**Opsi B:** Gunakan OIDC provider spesifik (sebutkan `issuer URL`, `client_id`, dan nama operator). | Endpoint OIDC callback tidak dapat dibuka karena tanpa allowlist `issuer` yang sah akan menimbulkan risiko account takeover. | Login OIDC dinonaktifkan; hanya Self-Hosted Login + TOTP MFA (`POST /auth/login` & `POST /auth/mfa/verify`) yang aktif. | `PENDING_OWNER_CONFIRMATION` |
| `Q-AUTH-003` / `Q-RBAC-012` / `Q-SEC-001` | Siapa individu/jabatan yang ditunjuk sebagai **Recovery Authority** jika akun `SUPER_ADMIN` terakhir kehilangan perangkat TOTP/terkunci, dan bagaimana prosedur verifikasi identitas serta audit break-glass dijalankan? | Sebutkan:<br>1. Nama/jabatan Recovery Verifier.<br>2. Metode verifikasi identitas.<br>3. Persetujuan tertulis yang wajib dicatat sebelum reset faktor MFA di database. | Tidak ada prosedur break-glass resmi saat `SUPER_ADMIN` kehilangan perangkat MFA. Invariant database tetap menolak penghapusan/penonaktifan `SUPER_ADMIN` aktif terakhir. | Self-service MFA reset / bypass untuk `SUPER_ADMIN` tidak disediakan (fail-closed); mutasi status `SUPER_ADMIN` terakhir ditolak otomatis oleh trigger/transaksi PostgreSQL. | `PENDING_OWNER_CONFIRMATION` |
| `Q-SEC-002` | Siapa pemilik kebijakan internal (Policy Owner) yang mengesahkan penerapan baseline password NIST SP 800-63B-4 (panjang minimum, pemeriksaan terhadap daftar password bocor, tanpa aturan komposisi sewenang-wenang)? | Nama & jabatan Policy Owner + tanggal pengesahan. | Standar teknis sudah diterapkan di kode (`password-service.js`), tetapi belum boleh diklaim sebagai kepatuhan audit organisasi. | Klaim kepatuhan formal NIST pada dokumen publik/eksternal ditahan. | `PENDING_OWNER_CONFIRMATION` |
| `Q-SEC-003` / `Q-SEC-004` | Apakah parameter operasional default saat ini disetujui untuk produksi: sesi idle `30 menit`, absolute `8 jam`, rate limit login `5 percobaan / 15 menit`, MFA `3 percobaan / 15 menit`, dan booking publik `30 request / menit / IP`? | **Opsi A:** Setujui parameter default saat ini.<br>**Opsi B:** Tetapkan angka TTL dan ambang batas rate-limit baru. | Parameter menggunakan baseline konservatif yang sudah diimplementasikan dan diuji. | Tidak ada pelonggaran batas sesi atau rate-limit tanpa persetujuan tertulis. | `PENDING_OWNER_CONFIRMATION` |
| `Q-SEC-005` | Provider email transaksional apa yang disetujui untuk pengiriman undangan admin / reset password, berapa masa berlaku token, dan siapa yang berhak memicu pengiriman? | Sebutkan nama provider SMTP/API, domain pengirim terverifikasi, dan TTL token (mis. `30 menit`). | Pengiriman email otomatis untuk invite/reset password belum dapat dihubungkan ke pihak ketiga. | Pengiriman email otomatis & endpoint password-reset publik tetap nonaktif; pembuatan akun dilakukan oleh `SUPER_ADMIN` terautentikasi. | `PENDING_OWNER_CONFIRMATION` |
| `Q-SEC-006` | Berapa lama retensi tabel `ActivityLog` di produksi dan apakah pencatatan `ipAddress` serta `userAgent` disetujui sesuai kebijakan privasi internal? | Sebutkan masa retensi (mis. `90 hari`, `1 tahun`, atau `permanen`) dan kebijakan pencatatan metadata request. | Pembersihan otomatis (archival/purging) log lama belum dijadwalkan agar tidak menghapus jejak audit tanpa izin. | Penghapusan/rotasi otomatis `ActivityLog` dinonaktifkan (seluruh jejak audit disimpan utuh). | `PENDING_OWNER_CONFIRMATION` |

### 2. Fleet Catalog & Inventory

| Decision ID | Pertanyaan Spesifik untuk Pemilik Bisnis | Format Jawaban / Pilihan yang Tersedia | Dampak Teknis & Operasional Jika Belum Diputuskan | Fitur yang Tetap Dinonaktifkan / Fail-Closed Sementara Menunggu | Status |
|---|---|---|---|---|---|
| `Q-FLEET-001` / `Q-MIG-003` | Daftar kategori dan model kendaraan mana yang sah dan terverifikasi untuk ditampilkan di Public Website produksi, serta siapa reviewer yang mengesahkan spesifikasi dan foto tiap model? | Lampirkan daftar final kategori & model yang disetujui (`slug`, `name`, `seatCount`, spesifikasi) + nama approver. | Database produksi dimulai tanpa seed katalog dummy; Public Website hanya menampilkan model dengan `isActive = true` dan `isVerified = true`. | Model kendaraan yang belum memiliki `isVerified = true` dan opsi rental aktif disembunyikan secara otomatis (fail-closed) dari API publik `GET /api/v1/public/vehicle-models`. | `PENDING_OWNER_CONFIRMATION` |
| `Q-FLEET-002` | Untuk setiap model kendaraan terverifikasi, opsi sewa mana yang diizinkan (`with_driver`, `self_drive`, atau keduanya)? | Tabel mapping `model -> [with_driver, self_drive]` yang disahkan owner. | Opsi rental menentukan pilihan yang valid pada form pemesanan publik. | `VehicleRentalOption` default `isEnabled = false`; permintaan booking publik dengan `rentalType` yang tidak diaktifkan pada model tersebut ditolak (`400 Bad Request`). | `PENDING_OWNER_CONFIRMATION` |
| `Q-FLEET-003` | Bagaimana aturan pengelolaan unit fisik kendaraan (nomor polisi/plat, warna, tahun, lokasi pool, dan waktu penugasan unit ke booking)? | Konfirmasi apakah penugasan unit fisik dilakukan manual setelah status booking `confirmed` atau memerlukan modul inventaris plat nomor terpisah. | Pemesanan publik saat ini mengikat ke `VehicleModel` (bukan plat nomor fisik) agar privasi armada terjaga. | Eksposur nomor polisi/plat unit fisik ke publik dinonaktifkan. | `PENDING_OWNER_CONFIRMATION` |

### 3. Booking Workflow & Privacy

| Decision ID | Pertanyaan Spesifik untuk Pemilik Bisnis | Format Jawaban / Pilihan yang Tersedia | Dampak Teknis & Operasional Jika Belum Diputuskan | Fitur yang Tetap Dinonaktifkan / Fail-Closed Sementara Menunggu | Status |
|---|---|---|---|---|---|
| `Q-BOOK-001` | Apakah alur transisi status booking saat ini (`waiting_confirmation` -> `under_verification` -> `confirmed` -> `completed`, atau `rejected` / `cancelled` dengan alasan wajib) sudah sesuai SOP operasional? | **Opsi A:** Setujui state machine saat ini.<br>**Opsi B:** Sebutkan perubahan aturan transisi atau role yang diizinkan. | State machine pada `booking.service.js` menolak transisi lompat atau pembukaan kembali status terminal (`completed`, `rejected`, `cancelled`). | Pembukaan kembali (reopen) booking berstatus terminal dan penghapusan permanen (hard-delete) booking dinonaktifkan. | `PENDING_OWNER_CONFIRMATION` |
| `Q-BOOK-002` | Apa aturan batas waktu pemesanan: zona waktu operasional resmi (mis. `Asia/Jakarta` / WIB), apakah pemesanan hari-H (`startsOn == hari ini`) diizinkan, dan berapa durasi sewa maksimum? | Sebutkan zona waktu, aturan same-day booking, dan maksimum hari sewa. | Server saat ini memvalidasi kalender `YYYY-MM-DD` murni dan `startsOn <= endsOn` tanpa memblokir zona waktu tertentu. | Klaim ketersediaan otomatis real-time / pemblokiran tanggal otomatis antar-unit tidak diaktifkan (booking berstatus `waiting_confirmation`). | `PENDING_OWNER_CONFIRMATION` |
| `Q-BOOK-003` | Apa cakupan wilayah penjemputan (`pickupLocation`) yang dilayani dan bagaimana penanganan permintaan di luar wilayah layanan? | **Opsi A:** Terima teks alamat bebas dan verifikasi manual oleh Admin/Staff.<br>**Opsi B:** Batasi pada daftar kota/area tertentu. | `pickupLocation` wajib diisi (non-empty string, maks 500 karakter) dan diverifikasi oleh tim operasional pada tahap `under_verification`. | Penolakan otomatis berbasis koordinat/geofencing tidak diaktifkan. | `PENDING_OWNER_CONFIRMATION` |
| `Q-BOOK-004` | Apa teks pemberitahuan privasi (privacy notice) resmi pada form booking publik dan berapa lama data kontak pelanggan pada booking disimpan sebelum dianonimkan? | Teks persetujuan privasi yang disetujui + durasi retensi data (mis. `1 tahun` setelah selesai). | Data pemesanan disimpan di tabel `Booking` hanya untuk keperluan tindak lanjut pesanan terkait. | Penggunaan nomor WhatsApp pelanggan untuk broadcast/marketing otomatis dinonaktifkan. | `PENDING_OWNER_CONFIRMATION` |

### 4. Pricing, Finance & WhatsApp Handoff

| Decision ID | Pertanyaan Spesifik untuk Pemilik Bisnis | Format Jawaban / Pilihan yang Tersedia | Dampak Teknis & Operasional Jika Belum Diputuskan | Fitur yang Tetap Dinonaktifkan / Fail-Closed Sementara Menunggu | Status |
|---|---|---|---|---|---|
| `Q-PRICE-001` .. `Q-PRICE-005` | Apa daftar tarif resmi per model & jenis rental, satuan hitung (`day` / `hour` / paket), komponen biaya tambahan (overtime/luar kota/BBM), aturan pajak, serta apakah perubahan tarif memerlukan persetujuan dua pejabat (maker-checker)? | Lampirkan tabel tarif resmi yang disahkan owner + aturan lembur/luar kota + kebijakan maker-checker. | Admin Panel dapat mengelola `PricingRule` internal, tetapi harga tidak dihitung sebagai tagihan final otomatis pada form publik. | Publikasi harga mengikat otomatis & kalkulator tagihan publik tetap dinonaktifkan; harga pada website publik tidak menggunakan angka dummy. | `PENDING_OWNER_CONFIRMATION` |
| `Q-WA-001` / `Q-WA-002` | Berapa nomor WhatsApp bisnis resmi Anantalia Trans (format internasional `628...`), siapa penanggung jawab nomor tersebut, dan pesan fallback apa yang ditampilkan bila pelanggan belum membuka WhatsApp? | Nomor WhatsApp resmi terverifikasi + nama PIC operasional. | Penyimpanan booking di PostgreSQL berjalan mandiri tanpa bergantung pada WhatsApp. | Pengiriman pesan WhatsApp otomatis via API pihak ketiga dan klaim bahwa pesan WhatsApp telah terkirim dinonaktifkan; sistem menampilkan kode booking resmi (`BK-XXX-XXX`) sebagai bukti permintaan tercatat. | `PENDING_OWNER_CONFIRMATION` |

### 5. Data Migration & Cutover

| Decision ID | Pertanyaan Spesifik untuk Pemilik Bisnis | Format Jawaban / Pilihan yang Tersedia | Dampak Teknis & Operasional Jika Belum Diputuskan | Fitur yang Tetap Dinonaktifkan / Fail-Closed Sementara Menunggu | Status |
|---|---|---|---|---|---|
| `Q-MIG-001` / `Q-MIG-002` | Apakah database produksi akan dimulai dalam keadaan **kosong bersih** (hanya role/permission resmi dan akun `SUPER_ADMIN` pertama), atau ada data historis terverifikasi yang wajib diimpor? | **Opsi A (Direkomendasikan):** Mulai produksi dengan database bersih + katalog terverifikasi.<br>**Opsi B:** Impor file sumber spesifik yang telah ditandatangani per baris oleh owner. | Mencegah masuknya data dummy/prototipe (`localStorage`, JSON contoh, atau spreadsheet kandidat) ke lingkungan produksi. | Seluruh script import data prototipe/dummy dinonaktifkan pada alur migrasi produksi (`prisma migrate deploy` hanya membuat skema tabel dan constraint). | `PENDING_OWNER_CONFIRMATION` |

---

## Lembar Pengesahan Pemilik Bisnis (Sign-Off)

Untuk mengaktifkan fitur yang saat ini ditahan dalam mode fail-closed di atas, pemilik bisnis harus mengisi pilihan yang disetujui dan menandatangani catatan pengesahan berikut:

- **Nama Pemilik Bisnis / Approver:** `___________________________`
- **Jabatan:** `___________________________`
- **Tanggal Pengesahan:** `____ / ____ / 2026`
- **Daftar Decision ID yang Disetujui:** `___________________________`
