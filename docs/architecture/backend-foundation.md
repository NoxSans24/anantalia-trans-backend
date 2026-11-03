# Backend Foundation

## Tujuan dan konteks

Backend Anantalia Trans akan menyediakan layanan sisi server untuk produk digital perusahaan. Repository backend dikelola Tim Anantalia Trans dan terpisah dari repository Frontend. Dokumen ini mencatat keputusan yang telah disetujui, arah arsitektur yang diusulkan, serta pekerjaan yang belum diputuskan atau diimplementasikan.

## Status pernyataan

- **Approved decision**: keputusan yang telah disetujui dan menjadi batas implementasi.
- **Proposed architectural direction**: prinsip rancangan untuk memandu implementasi; detailnya belum divalidasi.
- **Pending decision**: keputusan yang belum dibuat.
- **Not implemented**: belum ada kode atau konfigurasi yang menerapkannya.
- **Not yet validated**: belum dibuktikan melalui implementasi, pengujian, atau tinjauan operasional.

## Kepemilikan dan stack

### Approved decision

- Pemilik backend: Tim Anantalia Trans.
- Maintainer: Muhammad Ihsan Hanafi.
- Backend dan Frontend menggunakan repository terpisah.
- Nama repository: `anantalia-trans-backend`.
- Node.js 26.x, JavaScript, Express 5.x, dan npm.
- PostgreSQL 18, Prisma 7.x, dan Prisma Migrate.
- Repository GitHub bersifat public; rahasia dan data operasional tidak boleh dimasukkan.

### Not implemented

Belum ada `package.json`, dependency, aplikasi Express, Prisma schema, migration, koneksi database, endpoint, atau test suite.

## Batas tanggung jawab

### Proposed architectural direction

Backend bertanggung jawab atas pemrosesan sisi server, aturan domain yang kelak disepakati, akses data, dan kontrak API. Frontend bertanggung jawab atas antarmuka pengguna dan interaksi client. Frontend berkomunikasi dengan backend melalui kontrak API yang terdokumentasi; detail kontraknya belum ditetapkan.

### Pending decision

Daftar domain, integrasi eksternal, kontrak API, dan pembagian tanggung jawab rinci perlu disepakati bersama pemilik produk dan tim Frontend.

## Public API dan Admin API

### Proposed architectural direction

Pisahkan public API dan admin API secara jelas pada routing, dokumentasi, dan kebijakan akses agar antarmuka publik tidak mewarisi akses administratif. Terapkan validasi dan kontrol akses sesuai kebutuhan setiap permukaan API.

### Pending decision

Prefix, versi, hostname, autentikasi, otorisasi, role, permission, dan batas akses belum ditentukan. Tidak ada role atau permission yang diasumsikan oleh dokumen ini.

### Not implemented

Belum ada route public atau admin, autentikasi, authorization, maupun RBAC.

## Modular architecture

### Proposed architectural direction

Kelompokkan implementasi berdasarkan domain saat domain diketahui. Jaga pemisahan tanggung jawab antara transport/API, logika domain, dan akses data; hindari ketergantungan silang yang tidak diperlukan. Bentuk modul mengikuti kebutuhan nyata, bukan asumsi domain di muka.

### Pending decision

Daftar modul, batas domain, dan pola folder final belum ditetapkan.

## Validasi input dan error handling

### Proposed architectural direction

Validasi input pada batas masuk sebelum pemrosesan domain atau akses database. Berikan respons error yang konsisten dan aman untuk client; jangan mengirim detail internal atau rahasia. Catat konteks yang cukup untuk diagnosis tanpa mencatat kredensial atau data sensitif yang tidak diperlukan.

### Pending decision

Format error, status code per kasus, library validasi, dan kebijakan redaksi log belum ditetapkan.

## Database dan migration

### Approved decision

Database yang dipilih adalah PostgreSQL 18. Prisma 7.x digunakan sebagai ORM dan Prisma Migrate sebagai alat migration.

### Proposed architectural direction

Perubahan struktur database harus dikelola melalui migration yang ditinjau dan disimpan bersama source. Perubahan schema dan data perlu mempertimbangkan kompatibilitas serta strategi pemulihan sebelum diterapkan ke lingkungan bersama.

### Pending decision

Schema, model data, strategi deployment dan rollback migration, backup, serta kebijakan retensi belum ditetapkan.

### Not implemented

Belum ada schema, migration, database lokal atau remote, maupun konfigurasi koneksi.

## Security by default

### Proposed architectural direction

Validasi data yang tidak tepercaya, batasi akses sesuai kebutuhan, gunakan konfigurasi aman per lingkungan, dan hindari mengekspos rahasia atau detail internal. Rahasia tidak boleh disimpan di repository public; gunakan placeholder aman dalam contoh dokumentasi.

### Pending decision

Model autentikasi, otorisasi, pengelolaan secret, kebijakan CORS, rate limiting, dan kebutuhan keamanan spesifik domain perlu ditentukan sebelum implementasi terkait.

### Not implemented

Belum ada mekanisme keamanan aplikasi yang diterapkan.

## Logging dan auditability

### Proposed architectural direction

Logging sebaiknya cukup terstruktur untuk diagnosis dan audit perubahan penting, dengan akses dan retensi yang sesuai. Jangan mencatat token, password, connection string, atau data sensitif yang tidak diperlukan.

### Pending decision

Library, format, tujuan pengiriman, retensi, cakupan audit, dan kontrol akses log belum ditetapkan.

### Not implemented

Belum ada sistem logging atau audit.

## Konfigurasi environment

### Proposed architectural direction

Pisahkan konfigurasi per lingkungan dari source code. Validasi konfigurasi yang dibutuhkan saat aplikasi mulai berjalan. Contoh yang aman boleh menggunakan placeholder; nilai rahasia lokal dan file environment aktual tidak boleh masuk ke Git.

### Pending decision

Daftar variabel, sumber secret, konfigurasi per lingkungan, dan perilaku aplikasi saat konfigurasi tidak lengkap belum ditetapkan.

### Not implemented

Belum ada konfigurasi aplikasi atau contoh environment.

## Testing

### Proposed architectural direction

Tambahkan pengujian sesuai batas modul dan risiko: unit untuk perilaku domain, integrasi untuk kolaborasi dengan database atau adapter, serta pengujian kontrak API saat kontrak telah ditentukan. Pengujian harus dapat dijalankan dengan data non-produksi dan tanpa rahasia nyata.

### Pending decision

Framework, cakupan minimum, strategi fixture, serta penggunaan database untuk pengujian belum diputuskan.

### Not implemented dan Not yet validated

Belum ada test suite, dan tidak ada perilaku aplikasi yang dapat divalidasi saat ini.

## Ringkasan status

| Area | Status |
| --- | --- |
| Ownership, nama repository, dan stack | Approved decision |
| Batas modul, API, dan prinsip operasional | Proposed architectural direction |
| Endpoint, schema, role, permission, dan aturan bisnis | Pending decision |
| Aplikasi, dependency, database, migration, dan pengujian | Not implemented |
| Kesesuaian rancangan dengan kebutuhan operasional | Not yet validated |
