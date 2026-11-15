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
      create: (data) => prisma.vehicleModel.create({ data, include: { category: true } }),
      update: (id, data) => prisma.vehicleModel.update({ where: { id }, data, include: { category: true, rentalOptions: { orderBy: { rentalType: 'asc' } } } }),
      createOptions: (modelId) => prisma.vehicleRentalOption.createMany({ data: ['self_drive', 'with_driver'].map((rentalType) => ({ modelId, rentalType, isEnabled: false })) }),
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
          select: { id: true, slug: true, categoryId: true, name: true, seatCount: true, rentalOptions: { where: { ...(rentalType ? { rentalType } : {}), isEnabled: true }, select: { rentalType: true } } },
          orderBy: { name: 'asc' }, take, skip,
        });
      },
      modelCount: (where) => prisma.vehicleModel.count({ where }),
    },
  });
}
