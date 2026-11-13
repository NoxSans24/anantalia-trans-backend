import { createHash, createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEMO_CATEGORIES,
  DEMO_MODELS,
  DEMO_UNITS,
  DEMO_TARIFFS,
  DEMO_CUSTOMERS,
  DEMO_BOOKINGS,
  DEMO_FINANCE,
  DEMO_MESSAGES,
  DEMO_CONTENT,
  DEMO_TRAFFIC,
  DEMO_SETTINGS,
  DEMO_LOCATIONS,
} from './data/presentation-demo-dataset.js';
import { bootstrapSuperAdmin } from './bootstrap-super-admin.js';

function deterministicUuid(key) {
  const hex = createHash('sha256').update(`anantalia-demo:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function mapBookingStatus(statusRaw) {
  switch (statusRaw) {
    case 'confirmed':
    case 'Dikonfirmasi':
      return { status: 'confirmed', statusLabel: 'Dikonfirmasi' };
    case 'under_verification':
    case 'Sedang Berjalan':
      return { status: 'under_verification', statusLabel: 'Dalam Verifikasi' };
    case 'completed':
    case 'Selesai':
      return { status: 'completed', statusLabel: 'Selesai' };
    case 'cancelled':
    case 'Dibatalkan':
      return { status: 'cancelled', statusLabel: 'Dibatalkan' };
    case 'waiting_confirmation':
    case 'Menunggu Konfirmasi':
    default:
      return { status: 'waiting_confirmation', statusLabel: 'Menunggu Konfirmasi' };
  }
}

function mapMessageStatus(label) {
  if (label === 'Diproses') return 'read';
  if (label === 'Selesai') return 'replied';
  return 'unread';
}

export async function seedPresentationDemo(prisma) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DILARANG: Dataset presentasi demo tidak boleh dijalankan pada NODE_ENV=production.');
  }


  // 1. Categories (6 categories)
  const categoryBySlug = new Map();
  const categoryByName = new Map();
  for (const cat of DEMO_CATEGORIES) {
    const id = deterministicUuid(`category:${cat.slug}`);
    const record = await prisma.vehicleCategory.upsert({
      where: { slug: cat.slug },
      update: {
        name: cat.name,
        description: cat.description,
        sortOrder: cat.sortOrder,
        isActive: true,
      },
      create: {
        id,
        slug: cat.slug,
        name: cat.name,
        description: cat.description,
        sortOrder: cat.sortOrder,
        isActive: true,
      },
    });
    categoryBySlug.set(cat.slug, record);
    categoryByName.set(cat.name, record);
  }

  // Map demo units by model code
  const unitsByModelCode = new Map();
  for (const [unitId, modelCode, modelName, categoryName, year, color, city, statusDemo, note] of DEMO_UNITS) {
    if (!unitsByModelCode.has(modelCode)) unitsByModelCode.set(modelCode, []);
    unitsByModelCode.get(modelCode).push({
      unitId,
      modelCode,
      modelName,
      categoryName,
      year,
      color,
      city,
      statusDemo,
      note,
    });
  }

  // 2. Vehicle Models (61 models VM-001 .. VM-061)
  const modelByCode = new Map();
  const firstModelByCategory = new Map();
  for (const [code, name, categoryName, useCase, capacityLabel, seatCount, transmission, fuel, features] of DEMO_MODELS) {
    const cat = categoryByName.get(categoryName);
    if (!cat) continue;
    const slug = `${code.toLowerCase()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    const id = deterministicUuid(`model:${code}`);
    const demoUnits = unitsByModelCode.get(code) ?? [];
    const unitSummary = demoUnits.length > 0
      ? ` | Unit Demo: ${demoUnits.map((u) => `${u.unitId} (${u.city}, ${u.statusDemo})`).join(', ')}`
      : '';
    const description = `[${code}] ${useCase} • ${capacityLabel} • ${transmission} • ${fuel} • Fitur: ${features} (PENDING_OWNER_APPROVAL)${unitSummary}`;
    const publicSpecs = {
      modelCode: code,
      kegunaan: useCase,
      kapasitas: capacityLabel,
      transmisi: transmission,
      bahanBakar: fuel,
      fitur: features,
      verificationStatus: 'PENDING_OWNER_APPROVAL',
      availabilityStatus: 'NOT_SET',
      demoUnits,
    };

    const record = await prisma.vehicleModel.upsert({
      where: { slug },
      update: {
        categoryId: cat.id,
        name,
        seatCount,
        description,
        publicSpecs,
        isActive: true,
        isVerified: true,
      },
      create: {
        id,
        categoryId: cat.id,
        slug,
        name,
        seatCount,
        description,
        publicSpecs,
        isActive: true,
        isVerified: true,
      },
    });
    modelByCode.set(code, record);
    if (!firstModelByCategory.has(categoryName)) {
      firstModelByCategory.set(categoryName, record);
    }

    for (const rentalType of ['with_driver', 'self_drive']) {
      await prisma.vehicleRentalOption.upsert({
        where: { modelId_rentalType: { modelId: record.id, rentalType } },
        update: { isEnabled: true },
        create: {
          modelId: record.id,
          rentalType,
          isEnabled: true,
        },
      });
    }
  }

  // 3. Tariff Rules (TR-DEMO-01 .. TR-DEMO-06 -> 12 rules: with_driver + self_drive per category)
  for (const [tariffCode, categoryName, dailySelfDrive, dailyWithDriver, minDurationDays, overtimeHourly, note] of DEMO_TARIFFS) {
    const repModel = firstModelByCategory.get(categoryName);
    if (!repModel) continue;

    const rules = [
      {
        key: `${tariffCode}:self_drive`,
        rentalType: 'self_drive',
        baseRate: dailySelfDrive,
        notes: `[${tariffCode} | ${categoryName} - Lepas Kunci (Demo)] Min ${minDurationDays} hari, Overtime Rp ${overtimeHourly.toLocaleString('id-ID')}/jam. ${note} (DEMO_ONLY)`,
      },
      {
        key: `${tariffCode}:with_driver`,
        rentalType: 'with_driver',
        baseRate: dailyWithDriver,
        notes: `[${tariffCode} | ${categoryName} - Dengan Sopir (Demo)] Min ${minDurationDays} hari, Overtime Rp ${overtimeHourly.toLocaleString('id-ID')}/jam. ${note} (DEMO_ONLY)`,
      },
    ];

    for (const rule of rules) {
      const id = deterministicUuid(`pricing:${rule.key}`);
      await prisma.pricingRule.upsert({
        where: { id },
        update: {
          modelId: repModel.id,
          rentalType: rule.rentalType,
          baseRate: rule.baseRate,
          currency: 'IDR',
          billingUnit: 'day',
          isActive: true,
          notes: rule.notes,
        },
        create: {
          id,
          modelId: repModel.id,
          rentalType: rule.rentalType,
          baseRate: rule.baseRate,
          currency: 'IDR',
          billingUnit: 'day',
          isActive: true,
          notes: rule.notes,
        },
      });
    }
  }

  // 4. Customers (30 customers CUS-DEMO-001 .. CUS-DEMO-030)
  const customerByCode = new Map();
  for (const [code, fullName, email, phone, city, segment, totalBookingsDemo, statusLabel] of DEMO_CUSTOMERS) {
    const id = deterministicUuid(`customer:${code}`);
    const isActive = statusLabel !== 'Nonaktif';
    const notes = `[${code} | ${city} | Segmen: ${segment} | Total Booking Demo: ${totalBookingsDemo} | Status: ${statusLabel}] Data pelanggan sintetis untuk demonstrasi.`;
    const record = await prisma.customer.upsert({
      where: { id },
      update: {
        name: fullName,
        phone,
        email,
        isActive,
        notes,
      },
      create: {
        id,
        name: fullName,
        phone,
        email,
        isActive,
        notes,
      },
    });
    customerByCode.set(code, record);
  }

  // 5. Bookings (40 bookings BK-DEMO-0001 .. BK-DEMO-0040)
  const bookingByCode = new Map();
  for (const [
    bookingCode,
    orderDate,
    customerCode,
    customerName,
    modelCode,
    modelName,
    categoryName,
    startDate,
    endDate,
    pickupCity,
    destCity,
    serviceType,
    withDriverLabel,
    estimateIdr,
    statusRaw,
    channel,
    note,
  ] of DEMO_BOOKINGS) {
    const id = deterministicUuid(`booking:${bookingCode}`);
    const cat = categoryByName.get(categoryName);
    const mod = modelByCode.get(modelCode);
    const cust = customerByCode.get(customerCode);
    const { status, statusLabel } = mapBookingStatus(statusRaw);
    const rentalType = withDriverLabel === 'Ya' ? 'with_driver' : 'self_drive';
    const pickupLocation = `${pickupCity} -> ${destCity} (${serviceType})`;
    const additionalNotes = `[${channel} | Pelanggan: ${customerCode} | Model: ${modelCode} ${modelName} | Estimasi Demo: Rp ${Number(estimateIdr).toLocaleString('id-ID')}] ${note}`;
    const rawDigits = (cust?.phone ?? '6280000000000').replace(/[^0-9+]/g, '');

    const record = await prisma.booking.upsert({
      where: { bookingCode },
      update: {
        customerName,
        whatsappPhone: rawDigits,
        categoryId: cat?.id ?? 'unknown',
        modelId: mod?.id ?? 'unknown',
        rentalType,
        startsOn: startDate,
        endsOn: endDate,
        pickupLocation,
        additionalNotes,
        status,
        statusLabel,
      },
      create: {
        id,
        bookingCode,
        customerName,
        whatsappPhone: rawDigits,
        categoryId: cat?.id ?? 'unknown',
        modelId: mod?.id ?? 'unknown',
        rentalType,
        startsOn: startDate,
        endsOn: endDate,
        pickupLocation,
        additionalNotes,
        status,
        statusLabel,
        createdAt: new Date(`${orderDate}T08:00:00Z`),
      },
    });
    bookingByCode.set(bookingCode, record);
  }

  // 6. Finance Transactions (35 transactions FIN-DEMO-0001 .. FIN-DEMO-0035)
  for (const [finCode, txDate, bookingRef, typeLabel, categoryLabel, note, amountIdr, method, statusLabel] of DEMO_FINANCE) {
    const id = deterministicUuid(`finance:${finCode}`);
    const type = typeLabel === 'Pemasukan' ? 'income' : 'expense';
    const linkedBooking = bookingRef && bookingRef !== '-' ? bookingByCode.get(bookingRef) : null;
    const description = `[${finCode} | ${categoryLabel} | ${method} | ${statusLabel}] ${note}`;
    const isRecorded = String(statusLabel).startsWith('Tercatat');

    await prisma.financeTransaction.upsert({
      where: { id },
      update: {
        type,
        amount: Number(amountIdr),
        category: categoryLabel,
        description,
        bookingId: linkedBooking?.bookingCode ?? (bookingRef && bookingRef !== '-' ? bookingRef : null),
        date: txDate,
        status: isRecorded ? 'recorded' : 'pending',
      },
      create: {
        id,
        type,
        amount: Number(amountIdr),
        category: categoryLabel,
        description,
        bookingId: linkedBooking?.bookingCode ?? (bookingRef && bookingRef !== '-' ? bookingRef : null),
        date: txDate,
        status: isRecorded ? 'recorded' : 'pending',
        createdAt: new Date(`${txDate}T10:00:00Z`),
      },
    });
  }

  // 7. Inbox Messages (15 messages MSG-DEMO-001 .. MSG-DEMO-015)
  for (const [msgCode, msgDate, senderName, phone, subject, messageText, channel, statusLabel] of DEMO_MESSAGES) {
    const id = deterministicUuid(`message:${msgCode}`);
    const status = mapMessageStatus(statusLabel);
    const fullSubject = `[${msgCode} | ${channel}] ${subject}`;
    const numSuffix = msgCode.slice(-2);

    await prisma.inboxMessage.upsert({
      where: { id },
      update: {
        senderName,
        senderEmail: `pesan.${numSuffix}@example.test`,
        subject: fullSubject,
        content: `[Kontak Simulasi: ${phone}] ${messageText}`,
        status,
      },
      create: {
        id,
        senderName,
        senderEmail: `pesan.${numSuffix}@example.test`,
        subject: fullSubject,
        content: `[Kontak Simulasi: ${phone}] ${messageText}`,
        status,
        createdAt: new Date(`${msgDate}T09:30:00Z`),
      },
    });
  }

  // 8. Content Items (4 content items CNT-DEMO-001 .. CNT-DEMO-004)
  for (const [cntCode, pageName, title, summary, statusLabel, updatedDate, sourceStatus, note] of DEMO_CONTENT) {
    const id = deterministicUuid(`content:${cntCode}`);
    const slug = `${cntCode.toLowerCase()}-${pageName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const body = `${summary}\n\n[Halaman: ${pageName} | Status Sumber: ${sourceStatus} | Diperbarui: ${updatedDate}] ${note}`;

    await prisma.contentItem.upsert({
      where: { slug },
      update: {
        title: `[${pageName}] ${title}`,
        contentKey: cntCode.toLowerCase(),
        section: pageName.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        body,
        status: statusLabel.toLowerCase() === 'published' ? 'published' : 'draft',
      },
      create: {
        id,
        slug,
        contentKey: cntCode.toLowerCase(),
        section: pageName.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        title: `[${pageName}] ${title}`,
        body,
        status: 'draft',
      },
    });
  }

  // 9. System Settings + Analytics Traffic + Reference Locations Metadata
  const trafficPayload = DEMO_TRAFFIC.map(([date, uniqueVisitors, pageViews, formClicks, waClicks, conversionRate, topSource]) => ({
    date,
    uniqueVisitors,
    pageViews,
    formClicks,
    waClicks,
    conversionRate,
    topSource,
  }));

  const locationsPayload = DEMO_LOCATIONS.map(([code, city, province, islandGroup, status]) => ({
    code,
    city,
    province,
    islandGroup,
    status,
  }));

  const allSettings = [
    ...DEMO_SETTINGS,
    ['demo.analytics.traffic', JSON.stringify(trafficPayload)],
    ['demo.locations.reference', JSON.stringify(locationsPayload)],
    ['demo.locations.count', String(DEMO_LOCATIONS.length)],
    ['demo.units.count', String(DEMO_UNITS.length)],
  ];

  for (const [key, value] of allSettings) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  return {
    categories: DEMO_CATEGORIES.length,
    models: DEMO_MODELS.length,
    units: DEMO_UNITS.length,
    locations: DEMO_LOCATIONS.length,
    tariffs: DEMO_TARIFFS.length * 2,
    customers: DEMO_CUSTOMERS.length,
    bookings: DEMO_BOOKINGS.length,
    finance: DEMO_FINANCE.length,
    messages: DEMO_MESSAGES.length,
    content: DEMO_CONTENT.length,
    trafficDays: DEMO_TRAFFIC.length,
    settings: DEMO_SETTINGS.length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DILARANG: Jangan menjalankan seed:demo pada database produksi.');
    }
    if (process.env.NODE_ENV === 'test') {
      const { checkTestDatabase } = await import('../connection-check.mjs');
      await checkTestDatabase();
    }

    process.env.ARGON2_MEMORY_COST ||= '65536';
    process.env.ARGON2_TIME_COST ||= '3';
    process.env.ARGON2_PARALLELISM ||= '4';
    process.env.ARGON2_HASH_LENGTH ||= '32';

    const { createPrismaClient } = await import('../src/lib/prisma.js');
    const { hashPassword } = await import('../src/auth/password-service.js');
    const { createActivityLogService } = await import('../src/auth/activity-log-service.js');
    const { seedRolesAndPermissions } = await import('../src/lib/seed.js');
    const { createTotpKeyringProvider } = await import('../src/auth/totp-keyring-provider.js');
    const { createPrismaTotpFactorRepository } = await import('../src/auth/prisma-totp-factor.repository.js');
    const { createTotpFactorService } = await import('../src/auth/totp-factor-service.js');
    const { validateEnv } = await import('../src/config/env.js');

    const databaseUrl = process.env.NODE_ENV === 'test'
      ? (process.env.TEST_DATABASE_URL || process.env.DATABASE_URL)
      : validateEnv().databaseUrl;
    const prisma = createPrismaClient(databaseUrl);
    const activityLog = createActivityLogService({ prisma });

    await seedRolesAndPermissions(prisma);

    const email = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL || 'admin@anantalia.local';
    const username = process.env.BOOTSTRAP_SUPER_ADMIN_USERNAME || 'superadmin';
    const password = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD || 'AdminAnantalia2026!';

    const adminResult = await bootstrapSuperAdmin({
      prisma,
      hashPassword,
      email,
      username,
      displayName: 'Super Admin (Presentasi Demo)',
      password,
      activityLog,
    });

    if (adminResult.status === 'ALREADY_EXISTS') {
      await prisma.user.update({
        where: { id: adminResult.userId },
        data: { passwordHash: await hashPassword(password), status: 'ACTIVE', deletedAt: null },
      });
    }

    const summary = await seedPresentationDemo(prisma);

    process.stdout.write('============================================================\n');
    process.stdout.write('ANANTALIA TRANS — DATASET PRESENTASI (DEMO) BERHASIL DISEED\n');
    process.stdout.write('============================================================\n');
    process.stdout.write(`- Kategori Armada     : ${summary.categories} kategori\n`);
    process.stdout.write(`- Katalog Model Mobil : ${summary.models} model (VM-001 .. VM-061)\n`);
    process.stdout.write(`- Unit Kendaraan Demo : ${summary.units} unit (DU-001 .. DU-016)\n`);
    process.stdout.write(`- Lokasi Referensi    : ${summary.locations} kota (LOC-001 .. LOC-098)\n`);
    process.stdout.write(`- Aturan Tarif Demo   : ${summary.tariffs} aturan (TR-DEMO-01 .. TR-DEMO-06)\n`);
    process.stdout.write(`- Pelanggan Demo      : ${summary.customers} pelanggan (CUS-DEMO-001 .. CUS-DEMO-030)\n`);
    process.stdout.write(`- Booking Demo        : ${summary.bookings} pesanan (BK-DEMO-0001 .. BK-DEMO-0040)\n`);
    process.stdout.write(`- Transaksi Keuangan  : ${summary.finance} transaksi (FIN-DEMO-0001 .. FIN-DEMO-0035)\n`);
    process.stdout.write(`- Pesan Masuk Demo    : ${summary.messages} pesan (MSG-DEMO-001 .. MSG-DEMO-015)\n`);
    process.stdout.write(`- Konten CMS Draft    : ${summary.content} halaman (CNT-DEMO-001 .. CNT-DEMO-004)\n`);
    process.stdout.write(`- Analitik Trafik     : ${summary.trafficDays} hari (2026-10-07 .. 2026-11-05)\n`);
    process.stdout.write(`- Pengaturan Sistem   : ${summary.settings} pengaturan utama\n`);
    process.stdout.write('------------------------------------------------------------\n');
    process.stdout.write(`Login Email           : ${adminResult.email}\n`);
    process.stdout.write(`Login Username        : ${adminResult.username}\n`);
    process.stdout.write(`Login Password        : ${password}\n`);

    const keyringProvider = createTotpKeyringProvider({
      loadKeyring: async () => {
        const activeKeyId = process.env.TOTP_ACTIVE_KEY_ID;
        const configuredKeys = JSON.parse(process.env.TOTP_KEYRING ?? 'null');
        if (!activeKeyId || !configuredKeys || typeof configuredKeys !== 'object' || Array.isArray(configuredKeys)) return null;
        const keys = Object.fromEntries(Object.entries(configuredKeys).map(([id, encoded]) => [id, Buffer.from(encoded, 'base64url')]));
        return { activeKeyId, keys };
      },
    });
    const encryption = await keyringProvider.load();
    if (encryption) {
      const totpService = createTotpFactorService({
        repository: createPrismaTotpFactorRepository(prisma),
        encryption,
      });
      await prisma.totpFactor.updateMany({
        where: { userId: adminResult.userId, status: { in: ['PENDING', 'ACTIVE'] } },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      const enrollment = await totpService.startEnrollment({
        userId: adminResult.userId,
        accountName: adminResult.email,
      });

      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      const decodeBase32 = (val) => {
        let bits = 0; let current = 0; const bytes = [];
        for (const ch of val) {
          current = (current << 5) | alphabet.indexOf(ch);
          bits += 5;
          if (bits >= 8) { bytes.push((current >>> (bits - 8)) & 255); bits -= 8; }
        }
        return Buffer.from(bytes);
      };
      const codeAt = (secret, step) => {
        const counter = Buffer.alloc(8);
        counter.writeBigUInt64BE(BigInt(step));
        const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
        const offset = digest.at(-1) & 15;
        const value = ((digest[offset] & 127) << 24)
          | ((digest[offset + 1] & 255) << 16)
          | ((digest[offset + 2] & 255) << 8)
          | (digest[offset + 3] & 255);
        return String(value % 1_000_000).padStart(6, '0');
      };

      const currentStep = BigInt(Math.floor(Date.now() / 30_000));
      await totpService.confirmEnrollment({
        userId: adminResult.userId,
        factorId: enrollment.factorId,
        code: codeAt(enrollment.secret, currentStep - 1n),
      });

      process.stdout.write(`TOTP MFA Secret       : ${enrollment.secret}\n`);
      process.stdout.write(`Kode MFA 6-Digit (Now): ${codeAt(enrollment.secret, currentStep)}\n`);
      process.stdout.write(`Kode MFA (+30 detik)  : ${codeAt(enrollment.secret, currentStep + 1n)}\n`);
    }
    process.stdout.write('============================================================\n');

    await prisma.$disconnect();
  } catch (err) {
    process.stderr.write(`Seed demo failed: ${err.message}\n`);
    if (err?.code === 'P2021' || /does not exist in the current database/.test(String(err?.message))) {
      process.stderr.write('\nPETUNJUK: Tabel database belum dibuat. Jalankan migrasi Prisma terlebih dahulu pada database Anda:\n');
      process.stderr.write("  $env:NODE_ENV='development'; npx.cmd prisma migrate dev\n");
      process.stderr.write('lalu ulangi: npm.cmd run seed:demo\n');
    }
    process.exitCode = 1;
  }
}
