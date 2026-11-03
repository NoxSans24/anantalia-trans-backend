# Anantalia Trans Backend

Backend untuk mendukung layanan digital Anantalia Trans. Repository ini menjadi tempat bagi kode, dokumentasi, dan konfigurasi backend setelah fondasinya disiapkan.

## Tujuan dan status

Repository ini memisahkan pengembangan backend dari repository Frontend. Status saat ini: **initial foundation**. Belum ada aplikasi atau fitur backend yang diimplementasikan.

Backend dimiliki oleh Tim Anantalia Trans. Maintainer: Muhammad Ihsan Hanafi.

## Technology stack terpilih

- Node.js 26.x
- JavaScript
- Express 5.x
- npm
- PostgreSQL 18
- Prisma 7.x dan Prisma Migrate

Pilihan teknologi tersebut telah disetujui; dependency dan aplikasinya belum dipasang atau dibuat.

## Current Repository Structure

```text
.
├── .editorconfig
├── .gitignore
├── README.md
├── docs/
│   └── architecture/
│       └── backend-foundation.md
```

Ini adalah file dan direktori fondasi yang tersedia saat ini. Belum ada source aplikasi.

## Planned Repository Structure

```text
.
├── docs/
│   └── architecture/
│       └── backend-foundation.md
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
└── tests/
```

Struktur di atas adalah rencana untuk tahap implementasi berikutnya; `schema.prisma`, migration, source aplikasi, dan test suite belum tersedia. Susunan modul dan pengujian akan ditetapkan saat implementasi dimulai.

## Prasyarat

Untuk pekerjaan implementasi berikutnya, siapkan Node.js 26.x beserta npm. PostgreSQL 18 dan Prisma 7.x merupakan teknologi yang dipilih, tetapi belum diperlukan untuk membaca atau mengedit dokumentasi fondasi ini.

## Setup awal

1. Clone repository ini.
2. Baca [dokumen fondasi backend](docs/architecture/backend-foundation.md).
3. Sebelum implementasi, sepakati keputusan yang masih pending dan siapkan konfigurasi lokal tanpa memasukkan rahasia ke Git.

Belum ada `package.json`, perintah instalasi, maupun server untuk dijalankan.

## Status implementasi

Yang tersedia saat ini hanya dokumentasi fondasi, `.gitignore`, dan `.editorconfig`. Belum tersedia Express application, API, autentikasi, otorisasi, skema atau koneksi database, migration, maupun test suite.

Lihat [docs/architecture/backend-foundation.md](docs/architecture/backend-foundation.md) untuk keputusan yang disetujui, arah arsitektur yang diusulkan, dan hal yang masih pending.
