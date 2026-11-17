import express from 'express';

export function createAdminAccountRouter({ adminAccountService, authService, activityLog, logger } = {}) {
  if (!adminAccountService || !authService || !activityLog || !logger) {
    throw new TypeError('All admin account router dependencies required');
  }

  const router = express.Router();

  function paginationNumber(value, fallback, minimum, maximum = Number.MAX_SAFE_INTEGER) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
  }

  function validAccountId(value) {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  const DEFAULT_ERROR_MESSAGES = {
    PERMISSION_DENIED: 'Anda tidak memiliki izin untuk mengelola akun ini.',
    ACCOUNT_NOT_MANAGEABLE: 'Akun ini tidak dapat dikelola dari modul ini.',
    ACCOUNT_NOT_FOUND: 'Akun administrator tidak ditemukan.',
    ACCOUNT_CONFLICT: 'Email atau username sudah terdaftar pada akun lain.',
    LAST_SUPER_ADMIN_PROTECTED: 'Super Admin aktif terakhir tidak dapat dinonaktifkan atau dihapus.',
    INVALID_ACCOUNT: 'Data email atau username tidak valid (username minimal 3 karakter).',
    INVALID_ROLE: 'Peran yang dipilih tidak valid.',
    INVALID_PASSWORD: 'Kata sandi wajib diisi antara 8 hingga 128 karakter.',
    INTERNAL_ERROR: 'Terjadi kesalahan internal saat memproses permintaan.',
  };

  function sendError(res, error) {
    const code = error?.status ?? 'INTERNAL_ERROR';
    const status = code === 'PERMISSION_DENIED' || code === 'ACCOUNT_NOT_MANAGEABLE' ? 403
      : code === 'ACCOUNT_NOT_FOUND' ? 404
        : code === 'ACCOUNT_CONFLICT' || code === 'LAST_SUPER_ADMIN_PROTECTED' ? 409
          : code === 'INVALID_ACCOUNT' || code === 'INVALID_ROLE' || code === 'INVALID_PASSWORD' ? 400 : 500;
    const message = error?.message && status !== 500 ? error.message : (DEFAULT_ERROR_MESSAGES[code] || DEFAULT_ERROR_MESSAGES.INTERNAL_ERROR);
    return res.status(status).json({ error: { code, message } });
  }

  router.post('/admin/create', async (req, res) => {
    try {
      const { email, username, displayName, roles, password } = req.body ?? {};
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sesi login tidak valid.' } });
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        return res.status(400).json({
          error: {
            code: 'INVALID_PASSWORD',
            message: 'Kata sandi wajib diisi (8–128 karakter).',
          },
        });
      }

      const result = await adminAccountService.createAdmin({ actor: userId, email, username, displayName, roles, password });
      return res.status(201).json({
        id: result.id,
        email: result.email,
        username: result.username,
        displayName: result.displayName ?? null,
        roles: Array.isArray(result.roles) ? result.roles.map((r) => r.role?.code || r) : [],
      });
    } catch (error) {
      logger?.error?.('admin_create_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.get('/admin/list', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });

      await authService.requirePermission(userId, 'USER_VIEW');
      const limit = paginationNumber(req.query.limit, 50, 1, 100);
      const offset = paginationNumber(req.query.offset, 0, 0);
      if (limit === null || offset === null) return res.status(400).json({ error: { code: 'INVALID_PAGINATION' } });

      const admins = await adminAccountService.listAdmins(limit, offset);
      return res.status(200).json({ admins: admins.map(a => ({ id: a.id, email: a.email, username: a.username, displayName: a.displayName, status: a.status, roles: a.roles.map(r => r.role.code) })) });
    } catch (error) {
      logger?.error?.('admin_list_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.get('/admin/:id', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
      if (!validAccountId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID' } });

      await authService.requirePermission(userId, 'USER_VIEW');
      const profile = await adminAccountService.getAdminProfile(req.params.id);
      if (!profile) return res.status(404).json({ error: { code: 'NOT_FOUND' } });

      return res.status(200).json({ id: profile.id, email: profile.email, username: profile.username, displayName: profile.displayName, status: profile.status, roles: profile.roles.map(r => r.role.code) });
    } catch (error) {
      logger?.error?.('admin_get_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.post('/admin/:id/role', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
      if (!validAccountId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID' } });

      const { roles } = req.body;
      const result = await adminAccountService.updateAdminRole({ actor: userId, targetUserId: req.params.id, newRoles: roles });
      return res.status(200).json({ id: result.id, roles: result.roles.map(r => r.role.code) });
    } catch (error) {
      logger?.error?.('admin_role_update_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.post('/admin/:id/suspend', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
      if (!validAccountId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID' } });

      const result = await adminAccountService.suspendAdmin({ actor: userId, targetUserId: req.params.id });
      return res.status(200).json({ id: result.id, status: result.status });
    } catch (error) {
      logger?.error?.('admin_suspend_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.post('/admin/:id/disable', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
      if (!validAccountId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID' } });

      const result = await adminAccountService.disableAdmin({ actor: userId, targetUserId: req.params.id });
      return res.status(200).json({ id: result.id, status: result.status });
    } catch (error) {
      logger?.error?.('admin_disable_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.post('/admin/:id/reactivate', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
      if (!validAccountId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID' } });

      const result = await adminAccountService.reactivateAdmin({ actor: userId, targetUserId: req.params.id });
      return res.status(200).json({ id: result.id, status: result.status });
    } catch (error) {
      logger?.error?.('admin_reactivate_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.post('/admin/:id/delete', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
      if (!validAccountId(req.params.id)) return res.status(400).json({ error: { code: 'INVALID_ID' } });

      const result = await adminAccountService.softDeleteAdmin({ actor: userId, targetUserId: req.params.id });
      return res.status(200).json({ id: result.id, deletedAt: result.deletedAt });
    } catch (error) {
      logger?.error?.('admin_delete_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  return router;
}
