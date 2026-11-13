export function createPrismaDashboardRepository(prisma) {
  if (!prisma) throw new TypeError('Prisma client is required');
  return Object.freeze({
    countCategories: () => prisma.vehicleCategory.count({ where: { isActive: true } }),
    countModels: (where) => prisma.vehicleModel.count({ where }),
    countRentalCapabilities: (where) => prisma.vehicleRentalOption.count({ where }),
    countBookings: (where = {}) => prisma.booking.count({ where }),
  });
}
