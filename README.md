# Anantalia Trans Backend

Backend untuk mendukung layanan digital Anantalia Trans. Repository ini memisahkan pengembangan backend dari repository Frontend.

## Tujuan dan status

Status saat ini: **local application foundation implemented**. Tersedia bootstrap Express, validasi environment, health check database, error handling, konfigurasi Prisma Client, dan unit tests. Belum ada fitur bisnis atau bukti kesiapan produksi.

Backend dimiliki Tim Anantalia Trans. Maintainer: Muhammad Ihsan Hanafi.

## Technology stack terpilih

- Node.js 26.x
- JavaScript ES Modules
- Express 5.x
- npm
- PostgreSQL 18
- Prisma 7.x dan Prisma Migrate

Pilihan teknologi tersebut telah disetujui. Versi dependency dipatok dalam `package.json` dan `package-lock.json`.

## Current Repository Structure

```text
.
├── .editorconfig
├── .env.example
├── .gitignore
├── README.md
├── package.json
├── package-lock.json
├── prisma.config.js
├── prisma/
│   └── schema.prisma
├── src/
│   ├── app.js
│   ├── server.js
│   ├── config/env.js
│   ├── controllers/health.controller.js
│   ├── lib/logger.js
│   ├── lib/prisma.js
│   ├── middlewares/error.middleware.js
│   ├── middlewares/not-found.middleware.js
│   └── routes/health.routes.js
├── tests/
│   ├── integration/health.database.test.js
│   └── unit/app.test.js
└── docs/architecture/
    ├── backend-foundation.md
    ├── decision-reconciliation.md
    └── implementation-readiness.md
```

Prisma client output ada di `src/generated/prisma/` setelah generate dan diabaikan Git.

## Planned Repository Structure

```text
.
├── prisma/migrations/       # migration untuk keputusan schema yang disetujui
├── src/                     # modul domain dan adapter integrasi bila diperlukan
└── tests/                   # unit, integration, dan contract tests sesuai scope
```

Bagian di atas adalah rencana tahap berikutnya. Model bisnis, migration, endpoint bisnis, dan test suite bisnis belum tersedia. Prisma schema saat ini hanya mendefinisikan generator dan provider, tanpa model.

## Prasyarat

Siapkan Node.js 26.x dan npm. Untuk menjalankan server, siapkan PostgreSQL 18 development lokal. Validasi T4.6.1 menggunakan database kosong `anantalia_backend_dev` pada `127.0.0.1:5433`; database validasi `backend_validation` tidak digunakan oleh aplikasi. Server default hanya bind ke `127.0.0.1`; jangan gunakan database produksi.

## Instalasi dan menjalankan

1. Clone repository dan gunakan Node.js 26.x.
2. Jalankan `npm ci`.
3. Salin `.env.example` menjadi `.env`, lalu set `DATABASE_URL` ke kredensial development lokal. Jangan commit `.env`.
4. Jalankan `npm run prisma:generate`.
5. Jalankan `npm start`; default host/port adalah `127.0.0.1:3000`.

`npm run dev` menggunakan Node watch mode. Aplikasi memvalidasi `NODE_ENV`, `HOST`, `PORT`, serta URL PostgreSQL wajib saat startup. Belum ada migration untuk membuat tabel; health check hanya menjalankan `SELECT 1`.

## Test dan health check

- `npm test` meng-generate Prisma Client lalu menjalankan unit tests yang memakai dependency database tiruan.
- `npm run test:db` menjalankan integration check hanya jika `NODE_ENV=development` dan database URL menunjuk ke host lokal dengan nama database berakhiran `_dev` atau `_development`; selain itu tes dilewati.
- `GET /health` mengembalikan `200` jika query database berhasil dan `503` jika gagal. Respons berisi timestamp dan status database tanpa detail koneksi.
- `npm run prisma:validate` memvalidasi schema; `npm run prisma:generate` menghasilkan client. Bootstrap tidak menjalankan migration.

Validasi T4.6.1: Node.js 26.13.0 dan npm 11.19.0; Prisma validate/generate lulus, unit tests 8/8 lulus, integration health 1/1 lulus, dan server aktual memberi `200` dengan koneksi PostgreSQL 18. Ctrl+C menjalankan handler shutdown dan mencatat `server_stopped`. Ini bukti lokal development, bukan production readiness.

## Batasan implementasi

Yang tersedia hanya fondasi HTTP dengan endpoint health, Prisma schema kosong, dan automated unit tests. Belum tersedia autentikasi/OIDC/MFA, RBAC runtime, authorization policy, endpoint bisnis, migration, CI, deployment, observability operasional, atau production readiness.

Lihat [Backend Foundation](docs/architecture/backend-foundation.md), [Decision Reconciliation](docs/architecture/decision-reconciliation.md), dan [Implementation Readiness](docs/architecture/implementation-readiness.md) untuk status arsitektur dan keputusan.
