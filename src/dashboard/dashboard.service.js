export function createDashboardService({ repository, authorizationService } = {}) {
  if (!repository || !authorizationService) throw new TypeError('Dashboard dependencies are required');
  return Object.freeze({
    async getSummary({ actor } = {}) {
      await authorizationService.requirePermission(actor, 'DASHBOARD_VIEW');
      const basePromises = [
        repository.countCategories(),
        repository.countModels({ isActive: true }),
        repository.countModels({ isActive: true, isVerified: true }),
        repository.countModels({ isActive: true, isVerified: false }),
        repository.countRentalCapabilities({ isEnabled: true, model: { isActive: true, isVerified: true, category: { isActive: true } } }),
      ];
      if (typeof repository.countBookings === 'function') {
        const [
          vehicleCategories,
          activeModels,
          verifiedModels,
          pendingVerificationModels,
          publicRentalCapabilities,
          total,
          waitingConfirmation,
          confirmed,
          completed,
        ] = await Promise.all([
          ...basePromises,
          repository.countBookings({}),
          repository.countBookings({ status: 'waiting_confirmation' }),
          repository.countBookings({ status: 'confirmed' }),
          repository.countBookings({ status: 'completed' }),
        ]);
        return {
          summary: {
            vehicleCategories,
            activeModels,
            verifiedModels,
            pendingVerificationModels,
            publicRentalCapabilities,
            bookings: { total, waitingConfirmation, confirmed, completed },
          },
        };
      }
      const [vehicleCategories, activeModels, verifiedModels, pendingVerificationModels, publicRentalCapabilities] =
        await Promise.all(basePromises);
      return { summary: { vehicleCategories, activeModels, verifiedModels, pendingVerificationModels, publicRentalCapabilities } };
    },
  });
}
