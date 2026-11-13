import { randomUUID } from 'node:crypto';

function normalizePhone(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    const err = new Error('Format nomor telepon tidak valid');
    err.code = 'INVALID_INPUT';
    err.status = 400;
    throw err;
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const compact = trimmed.replace(/[\s()-]/g, '');
  if (!/^\+?[0-9]{8,16}$/.test(compact)) {
    const err = new Error('Nomor telepon harus terdiri dari 8-16 digit angka yang valid');
    err.code = 'INVALID_INPUT';
    err.status = 400;
    throw err;
  }
  return compact;
}

function normalizeEmail(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    const err = new Error('Format email tidak valid');
    err.code = 'INVALID_INPUT';
    err.status = 400;
    throw err;
  }
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    const err = new Error('Format alamat email tidak valid');
    err.code = 'INVALID_INPUT';
    err.status = 400;
    throw err;
  }
  return trimmed;
}

export function createCustomerService({ repository, authorizationService, activityLog } = {}) {
  async function assertPermission(userId, permission) {
    if (authorizationService) {
      const allowed = await authorizationService.hasPermission(userId, permission);
      if (!allowed) {
        const err = new Error('Permission denied');
        err.code = 'FORBIDDEN';
        err.status = 403;
        throw err;
      }
    }
  }

  return {
    async listCustomers({ userId, query = {} } = {}) {
      await assertPermission(userId, 'CUSTOMER_VIEW');
      const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);

      if (repository?.listCustomers) {
        return repository.listCustomers({ ...query, limit, offset });
      }
      return { items: [], page: { limit, offset, total: 0 } };
    },

    async getCustomerById({ userId, id } = {}) {
      await assertPermission(userId, 'CUSTOMER_VIEW');
      if (repository?.getCustomerById) {
        const item = await repository.getCustomerById(id);
        if (item) return { item };
      }
      const err = new Error('Customer not found');
      err.code = 'NOT_FOUND';
      err.status = 404;
      throw err;
    },

    async createCustomer({ userId, input } = {}) {
      await assertPermission(userId, 'CUSTOMER_CREATE');
      const { name, phone, email, notes } = input ?? {};
      if (!name || typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 150) {
        const err = new Error('Nama pelanggan wajib diisi (maksimal 150 karakter)');
        err.code = 'INVALID_INPUT';
        err.status = 400;
        throw err;
      }

      const normalizedPhone = normalizePhone(phone);
      const normalizedEmail = normalizeEmail(email);

      if ((normalizedPhone || normalizedEmail) && repository?.findDuplicateCustomer) {
        const dup = await repository.findDuplicateCustomer({
          phone: normalizedPhone,
          email: normalizedEmail,
        });
        if (dup) {
          const err = new Error(`Nomor telepon atau email sudah terdaftar pada pelanggan "${dup.name}".`);
          err.code = 'CUSTOMER_DUPLICATE';
          err.status = 409;
          throw err;
        }
      }

      const id = randomUUID();
      const customer = {
        id,
        name: name.trim(),
        phone: normalizedPhone,
        email: normalizedEmail,
        notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (repository?.createCustomer) {
        await repository.createCustomer(customer);
      }

      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: 'CUSTOMER_CREATED',
          resourceType: 'Customer',
          resourceId: id,
        }).catch(() => {});
      }

      return { item: customer };
    },

    async updateCustomer({ userId, id, input } = {}) {
      await assertPermission(userId, 'CUSTOMER_UPDATE');
      let existing = null;
      if (repository?.getCustomerByIdAnyStatus) {
        existing = await repository.getCustomerByIdAnyStatus(id);
      } else if (repository?.getCustomerById) {
        existing = await repository.getCustomerById(id);
      }
      if (!existing) {
        const err = new Error('Customer not found');
        err.code = 'NOT_FOUND';
        err.status = 404;
        throw err;
      }

      const nextName =
        input?.name !== undefined
          ? (typeof input.name === 'string' && input.name.trim().length > 0 && input.name.trim().length <= 150
              ? input.name.trim()
              : (() => {
                  const err = new Error('Nama pelanggan wajib diisi (maksimal 150 karakter)');
                  err.code = 'INVALID_INPUT';
                  err.status = 400;
                  throw err;
                })())
          : existing.name;

      const nextPhone = input?.phone !== undefined ? normalizePhone(input.phone) : existing.phone;
      const nextEmail = input?.email !== undefined ? normalizeEmail(input.email) : existing.email;

      if ((nextPhone || nextEmail) && repository?.findDuplicateCustomer) {
        const dup = await repository.findDuplicateCustomer({
          phone: nextPhone,
          email: nextEmail,
          excludeId: id,
        });
        if (dup) {
          const err = new Error(`Nomor telepon atau email sudah digunakan oleh pelanggan "${dup.name}".`);
          err.code = 'CUSTOMER_DUPLICATE';
          err.status = 409;
          throw err;
        }
      }

      const nextIsActive = typeof input?.isActive === 'boolean' ? input.isActive : existing.isActive;
      const updated = {
        ...existing,
        name: nextName,
        phone: nextPhone,
        email: nextEmail,
        notes: input?.notes !== undefined ? (typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim() : null) : existing.notes,
        isActive: nextIsActive,
        updatedAt: new Date().toISOString(),
      };

      if (repository?.updateCustomer) {
        await repository.updateCustomer(updated);
      }

      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: nextIsActive !== existing.isActive ? 'CUSTOMER_STATUS_CHANGED' : 'CUSTOMER_UPDATED',
          resourceType: 'Customer',
          resourceId: id,
          details: nextIsActive !== existing.isActive ? { isActive: nextIsActive } : undefined,
        }).catch(() => {});
      }

      return { item: updated };
    },

    async deleteCustomer({ userId, id } = {}) {
      await assertPermission(userId, 'CUSTOMER_DELETE');
      let existing = null;
      if (repository?.getCustomerById) {
        existing = await repository.getCustomerById(id);
      }
      if (!existing) {
        const err = new Error('Customer not found');
        err.code = 'NOT_FOUND';
        err.status = 404;
        throw err;
      }

      if (repository?.deactivateCustomer) {
        await repository.deactivateCustomer(id);
      }

      if (activityLog?.log) {
        await activityLog.log({
          actor: userId,
          action: 'CUSTOMER_DEACTIVATED',
          resourceType: 'Customer',
          resourceId: id,
        }).catch(() => {});
      }

      return { success: true };
    },
  };
}
