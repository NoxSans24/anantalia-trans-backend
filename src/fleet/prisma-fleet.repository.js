export function createPrismaFleetRepository(prisma) {
  if (!prisma) throw new TypeError('Prisma client required');
  return Object.freeze({
    transaction: (work) => prisma.$transaction((tx) => work(createPrismaFleetRepository(tx))),
    activityLog: prisma.activityLog,
    category: {
      list: (where, take, skip) => prisma.vehicleCategory.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], take, skip }),
      count: (where) => prisma.vehicleCategory.count({ where }),
      get: (id) => prisma.vehicleCategory.findUnique({ where: { id } }),
      create: (data) => prisma.vehicleCategory.create({ data }),
      update: (id, data) => prisma.vehicleCategory.update({ where: { id }, data }),
    },
    model: {
      list: (where, take, skip) => prisma.vehicleModel.findMany({ where, include: { category: true, rentalOptions: { orderBy: { rentalType: 'asc' } } }, orderBy: { name: 'asc' }, take, skip }),
      count: (where) => prisma.vehicleModel.count({ where }),
      get: (id) => prisma.vehicleModel.findUnique({ where: { id }, include: { category: true, rentalOptions: { orderBy: { rentalType: 'asc' } } } }),
      findBySlug: (slug) => prisma.vehicleModel.findUnique({ where: { slug }, include: { category: true, rentalOptions: { orderBy: { rentalType: 'asc' } } } }),
      create: (data) => prisma.vehicleModel.create({ data, include: { category: true } }),
      update: (id, data) => prisma.vehicleModel.update({ where: { id }, data, include: { category: true, rentalOptions: { orderBy: { rentalType: 'asc' } } } }),
      createOptions: (modelId) => prisma.vehicleRentalOption.createMany({ data: ['self_drive', 'with_driver'].map((rentalType) => ({ modelId, rentalType, isEnabled: false })) }),
      disableAllRentalOptions: (modelId) => prisma.vehicleRentalOption.updateMany({ where: { modelId }, data: { isEnabled: false } }),
      hasRelations: async (id, slug = null) => {
        const unitCount = typeof prisma.vehicleUnit?.count === 'function'
          ? await prisma.vehicleUnit.count({ where: { modelId: id } })
          : 0;
        const bookingCount = typeof prisma.booking?.count === 'function'
          ? await prisma.booking.count({
              where: {
                OR: [{ modelId: id }, ...(slug ? [{ modelId: slug }] : [])],
              },
            })
          : 0;
        return { unitCount, bookingCount, hasRelations: unitCount + bookingCount > 0 };
      },
      delete: async (id) => {
        await prisma.vehicleRentalOption.deleteMany({ where: { modelId: id } });
        return prisma.vehicleModel.delete({ where: { id } });
      },
      countUsingMedia: async (mediaId, excludeModelId = null) => {
        if (!mediaId || typeof prisma.vehicleModel?.findMany !== 'function') return 0;
        const rows = await prisma.vehicleModel.findMany({
          where: excludeModelId ? { id: { not: excludeModelId } } : {},
          select: { id: true, publicSpecs: true },
        });
        return rows.filter((row) => {
          const specs = row.publicSpecs && typeof row.publicSpecs === 'object' ? row.publicSpecs : null;
          return specs && (specs.imageMediaId === mediaId || String(specs.imageUrl || '').includes(mediaId));
        }).length;
      },
    },
    rentalOption: {
      upsert: (modelId, rentalType, data) => prisma.vehicleRentalOption.upsert({
        where: { modelId_rentalType: { modelId, rentalType } },
        create: { modelId, rentalType, ...data },
        update: data,
      }),
    },
    unit: {
      list: (where, take = 25, skip = 0) => prisma.vehicleUnit.findMany({
        where,
        include: {
          model: { select: { id: true, name: true, slug: true, categoryId: true } },
          maintenances: { orderBy: [{ serviceDate: 'desc' }, { createdAt: 'desc' }], take: 3 },
          bookingAssignments: {
            where: { status: 'assigned' },
            include: { booking: { select: { id: true, bookingCode: true, startsOn: true, endsOn: true, status: true, customerName: true } } },
          },
        },
        orderBy: [{ updatedAt: 'desc' }],
        take,
        skip,
      }),
      count: (where) => prisma.vehicleUnit.count({ where }),
      groupByStatus: () => prisma.vehicleUnit.groupBy({ by: ['status'], where: { isActive: true }, _count: { _all: true } }),
      get: (id) => prisma.vehicleUnit.findUnique({
        where: { id },
        include: {
          model: { select: { id: true, name: true, slug: true, categoryId: true } },
          maintenances: { orderBy: [{ serviceDate: 'desc' }, { createdAt: 'desc' }] },
          bookingAssignments: {
            include: { booking: { select: { id: true, bookingCode: true, startsOn: true, endsOn: true, status: true, customerName: true } } },
            orderBy: { assignedAt: 'desc' },
          },
        },
      }),
      findByPlate: (plateNumber) => prisma.vehicleUnit.findUnique({ where: { plateNumber } }),
      create: (data) => prisma.vehicleUnit.create({
        data,
        include: { model: { select: { id: true, name: true, slug: true, categoryId: true } } },
      }),
      update: async (id, data, expectedVersion) => {
        if (expectedVersion !== undefined && expectedVersion !== null) {
          const res = await prisma.vehicleUnit.updateMany({
            where: { id, version: expectedVersion },
            data: { ...data, version: { increment: 1 } },
          });
          if (res.count === 0) return null;
          return prisma.vehicleUnit.findUnique({
            where: { id },
            include: { model: { select: { id: true, name: true, slug: true, categoryId: true } } },
          });
        }
        return prisma.vehicleUnit.update({
          where: { id },
          data: { ...data, version: { increment: 1 } },
          include: { model: { select: { id: true, name: true, slug: true, categoryId: true } } },
        });
      },
      hasHistory: async (id) => {
        const [mCount, aCount] = await Promise.all([
          prisma.vehicleMaintenance.count({ where: { unitId: id } }),
          prisma.bookingUnitAssignment.count({ where: { unitId: id } }),
        ]);
        return mCount + aCount > 0;
      },
      delete: (id) => prisma.vehicleUnit.delete({ where: { id } }),
    },
    maintenance: {
      listByUnit: (unitId) => prisma.vehicleMaintenance.findMany({
        where: { unitId },
        orderBy: [{ serviceDate: 'desc' }, { createdAt: 'desc' }],
      }),
      get: (id) => prisma.vehicleMaintenance.findUnique({ where: { id } }),
      create: (data) => prisma.vehicleMaintenance.create({ data }),
      update: (id, data) => prisma.vehicleMaintenance.update({ where: { id }, data }),
    },
    public: {
      rentalTypes: () => prisma.vehicleRentalOption.findMany({
        where: { isEnabled: true, model: { isActive: true, isVerified: true, category: { isActive: true } } },
        distinct: ['rentalType'], select: { rentalType: true }, orderBy: { rentalType: 'asc' },
      }),
      categories: (rentalType) => prisma.vehicleCategory.findMany({
        where: { isActive: true, models: { some: { isActive: true, isVerified: true, rentalOptions: { some: { rentalType, isEnabled: true } } } } },
        select: { id: true, slug: true, name: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      models: (where, take, skip) => {
        const rentalType = where?.rentalOptions?.some?.rentalType;
        return prisma.vehicleModel.findMany({
          where,
          select: {
            id: true,
            slug: true,
            categoryId: true,
            name: true,
            description: true,
            seatCount: true,
            publicSpecs: true,
            rentalOptions: { where: { ...(rentalType ? { rentalType } : {}), isEnabled: true }, select: { rentalType: true } },
          },
          orderBy: { name: 'asc' },
          take,
          skip,
        });
      },
      modelCount: (where) => prisma.vehicleModel.count({ where }),
      catalog: async ({ categoryId, q, limit = 100, offset = 0 } = {}) => {
        const where = {
          isActive: true,
          isVerified: true,
          category: { isActive: true },
          ...(categoryId ? { categoryId } : {}),
          ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }] } : {}),
        };
        const [models, total, pricingRules, units] = await Promise.all([
          prisma.vehicleModel.findMany({
            where,
            include: {
              category: { select: { id: true, slug: true, name: true, sortOrder: true } },
              rentalOptions: { where: { isEnabled: true }, select: { rentalType: true }, orderBy: { rentalType: 'asc' } },
            },
            orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
            take: limit,
            skip: offset,
          }),
          prisma.vehicleModel.count({ where }),
          typeof prisma.pricingRule?.findMany === 'function'
            ? prisma.pricingRule.findMany({ where: { isActive: true }, orderBy: { baseRate: 'asc' } })
            : Promise.resolve([]),
          typeof prisma.vehicleUnit?.findMany === 'function'
            ? prisma.vehicleUnit.findMany({ where: { isActive: true }, select: { modelId: true, status: true } })
            : Promise.resolve([]),
        ]);
        return { models, total, pricingRules, units };
      },
      modelByIdOrSlug: async (idOrSlug, isUuid) => {
        const where = isUuid
          ? { id: idOrSlug, isActive: true, isVerified: true, category: { isActive: true } }
          : { slug: idOrSlug, isActive: true, isVerified: true, category: { isActive: true } };
        const model = await prisma.vehicleModel.findFirst({
          where,
          include: {
            category: { select: { id: true, slug: true, name: true } },
            rentalOptions: { where: { isEnabled: true }, select: { rentalType: true }, orderBy: { rentalType: 'asc' } },
          },
        });
        if (!model) return null;
        const [pricingRules, units] = await Promise.all([
          typeof prisma.pricingRule?.findMany === 'function'
            ? prisma.pricingRule.findMany({
                where: { isActive: true, modelId: { in: [model.id, model.slug] } },
                orderBy: { baseRate: 'asc' },
              })
            : Promise.resolve([]),
          typeof prisma.vehicleUnit?.findMany === 'function'
            ? prisma.vehicleUnit.findMany({ where: { modelId: model.id, isActive: true }, select: { status: true } })
            : Promise.resolve([]),
        ]);
        return { model, pricingRules, units };
      },
    },
  });
}
