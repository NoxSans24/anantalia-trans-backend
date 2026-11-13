import express from 'express';

function sendRouteError(req, res, error, logger, event) {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
  const code = status < 500 && typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR';
  const message = status < 500 && typeof error?.message === 'string' ? error.message : 'An unexpected error occurred';
  if (status >= 500) {
    logger?.error?.(event, { requestId: req.id, errorType: error?.constructor?.name ?? 'Error' });
  }
  return res.status(status).json({ error: { code, message } });
}

export function createPublicBookingRouter({ bookingService, rateLimitMiddleware, logger } = {}) {
  const router = express.Router();

  router.post('/booking-requests', async (req, res) => {
    try {
      if (rateLimitMiddleware?.checkPublicBooking) {
        const limit = rateLimitMiddleware.checkPublicBooking(req);
        if (!limit.allowed) {
          return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many booking requests' } });
        }
      }
      const result = await bookingService.createPublicBookingRequest(req.body);
      return res.status(201).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'public_booking_request_failed');
    }
  });

  return router;
}

export function createAdminBookingRouter({ bookingService, logger } = {}) {
  const router = express.Router();

  router.get('/bookings', async (req, res) => {
    try {
      const result = await bookingService.listBookings({ userId: req.userId, query: req.query });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'admin_booking_list_failed');
    }
  });

  router.get('/bookings/:id', async (req, res) => {
    try {
      const result = await bookingService.getBookingById({ userId: req.userId, id: req.params.id });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'admin_booking_get_failed');
    }
  });

  router.patch('/bookings/:id/status', async (req, res) => {
    try {
      const { status, reason } = req.body ?? {};
      const result = await bookingService.updateBookingStatus({
        userId: req.userId,
        id: req.params.id,
        newStatus: status,
        reason,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'admin_booking_status_failed');
    }
  });

  router.patch('/bookings/:id', async (req, res) => {
    try {
      const result = await bookingService.updateBookingDetails({
        userId: req.userId,
        id: req.params.id,
        patch: req.body ?? {},
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'admin_booking_update_failed');
    }
  });

  router.get('/bookings/:id/available-units', async (req, res) => {
    try {
      const result = await bookingService.listAvailableUnitsForBooking({
        userId: req.userId,
        bookingId: req.params.id,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'admin_booking_available_units_failed');
    }
  });

  router.post('/bookings/:id/assign-unit', async (req, res) => {
    try {
      const result = await bookingService.assignUnitToBooking({
        userId: req.userId,
        bookingId: req.params.id,
        unitId: req.body?.unitId,
        notes: req.body?.notes,
      });
      return res.status(200).json(result);
    } catch (error) {
      return sendRouteError(req, res, error, logger, 'admin_booking_assign_unit_failed');
    }
  });

  return router;
}
