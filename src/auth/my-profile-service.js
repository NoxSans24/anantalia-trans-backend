const DEFAULT_USER_PREFS = Object.freeze({
  theme: 'light',
  tableDensity: 'comfortable',
  pageSize: 20,
  sidebarCollapsed: false,
  notifyNewMessage: true,
  notifyNewBooking: true,
  notifyBookingStatus: true,
  notifyPayment: true,
  notifyFleetMaintenance: true,
  notifySystemAlert: true,
});

function rejected(status) {
  return Object.freeze({ status });
}

function safeUser(user, meta = {}) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  const roles = Array.isArray(user.roles) ? user.roles.map((r) => r.role?.code || r.code).filter(Boolean) : [];
  return {
    ...safe,
    roles,
    phone: meta.phone ?? '',
    jobTitle: meta.jobTitle ?? '',
    avatarDataUrl: meta.avatarDataUrl ?? null,
  };
}

function parseJsonSetting(raw, fallback) {
  if (!raw || typeof raw !== 'string') return { ...fallback };
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? { ...fallback, ...parsed } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function validateAvatarDataUrl(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw rejected('INVALID_PROFILE_VALUE');
  const trimmed = value.trim();
  const match = trimmed.match(/^data:image\/(png|jpeg|jpg|webp);base64,([\s\S]+)$/i);
  if (!match) throw rejected('INVALID_PROFILE_VALUE');
  const rawFormat = match[1].toLowerCase();
  const format = rawFormat === 'jpg' ? 'jpeg' : rawFormat;
  const cleanBase64 = match[2].replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(cleanBase64)) throw rejected('INVALID_PROFILE_VALUE');
  const bytes = Buffer.from(cleanBase64, 'base64');
  if (bytes.length === 0 || bytes.length > 262144) throw rejected('INVALID_PROFILE_VALUE');
  const isPng = format === 'png' && bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = format === 'jpeg' && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = format === 'webp' && bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!isPng && !isJpeg && !isWebp) throw rejected('INVALID_PROFILE_VALUE');
  return `data:image/${format};base64,${cleanBase64}`;
}

function normalizePhone(phone) {
  if (phone === null || phone === undefined) return '';
  if (typeof phone !== 'string') throw rejected('INVALID_PROFILE_VALUE');
  const trimmed = phone.trim();
  if (!trimmed) return '';
  const normalized = trimmed.replace(/[\s()-]/g, '');
  if (!/^\+?[0-9]{8,20}$/.test(normalized)) throw rejected('INVALID_PROFILE_VALUE');
  return normalized;
}

export function createMyProfileService({ prisma, passwordService, activityLog, totpFactorService, settingsRepository } = {}) {
  if (!prisma || !passwordService || !activityLog) throw new TypeError('All dependencies required');

  async function readUserMeta(userId) {
    if (!settingsRepository?.get) return {};
    return parseJsonSetting(await settingsRepository.get(`user_profile_meta:${userId}`), {});
  }

  async function getProfile(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: true } } } });
    if (!user) throw rejected('ACCOUNT_NOT_FOUND');
    const meta = await readUserMeta(userId);
    return safeUser(user, meta);
  }

  async function getMfaStatus(userId) {
    if (!userId) throw rejected('ACCOUNT_NOT_FOUND');
    const factor = await prisma.totpFactor.findFirst({
      where: { userId, status: { in: ['ACTIVE', 'PENDING'] } },
      select: { id: true, status: true, createdAt: true, confirmedAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return {
      hasActiveTotp: factor?.status === 'ACTIVE',
      status: factor?.status ?? 'NONE',
      factorId: factor?.id ?? null,
      confirmedAt: factor?.confirmedAt ?? null,
    };
  }

  async function startMfaEnrollment(userId) {
    if (!totpFactorService) throw rejected('MFA_NOT_CONFIGURED');
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, status: true, deletedAt: true } });
    if (!user || user.status !== 'ACTIVE' || user.deletedAt) throw rejected('ACCOUNT_NOT_FOUND');

    const result = await totpFactorService.startEnrollment({ userId, accountName: user.email });
    if (result.status !== 'TOTP_ENROLLMENT_PENDING') {
      throw rejected('MFA_ENROLLMENT_FAILED');
    }
    await activityLog.log({
      actor: userId,
      action: 'MFA_ENROLLMENT_STARTED',
      resourceType: 'TotpFactor',
      resourceId: result.factorId,
      targetUserId: userId,
      client: prisma,
    }).catch(() => {});

    return {
      factorId: result.factorId,
      secret: result.secret,
      provisioningUri: result.provisioningUri,
    };
  }

  async function confirmMfaEnrollment(userId, { factorId, code } = {}) {
    if (!totpFactorService) throw rejected('MFA_NOT_CONFIGURED');
    if (!factorId || !code) throw rejected('INVALID_PROFILE_VALUE');

    const result = await totpFactorService.confirmEnrollment({ userId, factorId, code });
    if (result.status !== 'TOTP_ENROLLMENT_CONFIRMED') {
      throw rejected('MFA_VERIFICATION_FAILED');
    }
    await activityLog.log({
      actor: userId,
      action: 'MFA_FACTOR_CONFIRMED',
      resourceType: 'TotpFactor',
      resourceId: factorId,
      targetUserId: userId,
      client: prisma,
    }).catch(() => {});

    return { status: 'MFA_FACTOR_CONFIRMED' };
  }

  async function revokeMfaFactor(userId, { factorId } = {}) {
    if (!totpFactorService) throw rejected('MFA_NOT_CONFIGURED');
    if (!factorId) throw rejected('INVALID_PROFILE_VALUE');

    const result = await totpFactorService.revokeFactor({ userId, factorId });
    if (result.status !== 'TOTP_FACTOR_REVOKED') {
      throw rejected('MFA_REVOCATION_FAILED');
    }
    await activityLog.log({
      actor: userId,
      action: 'MFA_FACTOR_REVOKED',
      resourceType: 'TotpFactor',
      resourceId: factorId,
      targetUserId: userId,
      client: prisma,
    }).catch(() => {});

    return { status: 'MFA_FACTOR_REVOKED' };
  }

  async function updateEmail() {
    throw rejected('EMAIL_VERIFICATION_REQUIRED');
  }

  async function updateIdentifier(userId, value, field, action) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized.length < 3 || normalized.length > 64) throw rejected('INVALID_PROFILE_VALUE');
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.user.update({ where: { id: userId }, data: { [field]: normalized } });
        await activityLog.log({ actor: userId, action, resourceType: 'User', resourceId: userId, targetUserId: userId, client: tx });
        return row;
      });
      const meta = await readUserMeta(userId);
      return safeUser(updated, meta);
    } catch (error) {
      if (error?.code === 'P2002') throw rejected('PROFILE_VALUE_IN_USE');
      throw error;
    }
  }

  function updateUsername(userId, username) {
    return updateIdentifier(userId, username, 'username', 'PROFILE_USERNAME_UPDATED');
  }

  async function updateDisplayName(userId, displayName) {
    if (displayName !== null && typeof displayName !== 'string') throw rejected('INVALID_PROFILE_VALUE');
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id: userId },
        data: { displayName: typeof displayName === 'string' && displayName.trim() ? displayName.trim() : null },
      });
      await activityLog.log({ actor: userId, action: 'PROFILE_DISPLAY_NAME_UPDATED', resourceType: 'User', resourceId: userId, targetUserId: userId, client: tx });
      return row;
    });
    const meta = await readUserMeta(userId);
    return safeUser(updated, meta);
  }

  async function changePassword(userId, oldPassword, newPassword, verifyPassword) {
    if (typeof verifyPassword !== 'function') throw new TypeError('Password verifier is required');
    if (typeof newPassword !== 'string' || newPassword.length === 0) {
      throw rejected('INVALID_PROFILE_VALUE');
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, passwordHash: true } });
    if (!user) throw rejected('ACCOUNT_NOT_FOUND');
    if (user.passwordHash) {
      if (typeof oldPassword !== 'string' || oldPassword.length === 0) throw rejected('INVALID_PROFILE_VALUE');
      if (!await verifyPassword(oldPassword, user.passwordHash)) throw rejected('CURRENT_PASSWORD_INVALID');
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      throw rejected('INVALID_PROFILE_VALUE');
    }
    const passwordHash = await passwordService.hash(newPassword);
    return prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({ where: { id: userId, passwordHash: user.passwordHash }, data: { passwordHash } });
      if (updated.count !== 1) throw rejected('PROFILE_UPDATE_CONFLICT');
      await activityLog.log({ actor: userId, action: 'PASSWORD_CHANGED', resourceType: 'User', resourceId: userId, targetUserId: userId, client: tx });
      return { status: 'PASSWORD_CHANGED' };
    });
  }

  async function updateProfileMeta(userId, payload = {}) {
    if (!userId) throw rejected('ACCOUNT_NOT_FOUND');
    const current = await readUserMeta(userId);
    const next = { ...current };
    if (Object.prototype.hasOwnProperty.call(payload, 'phone')) {
      next.phone = normalizePhone(payload.phone);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'jobTitle')) {
      const jt = typeof payload.jobTitle === 'string' ? payload.jobTitle.trim() : '';
      if (jt.length > 100) throw rejected('INVALID_PROFILE_VALUE');
      next.jobTitle = jt;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'avatarDataUrl')) {
      next.avatarDataUrl = validateAvatarDataUrl(payload.avatarDataUrl);
    }
    if (settingsRepository?.set) {
      await settingsRepository.set(`user_profile_meta:${userId}`, JSON.stringify(next));
    }
    await activityLog.log({
      actor: userId,
      action: 'PROFILE_META_UPDATED',
      resourceType: 'User',
      resourceId: userId,
      targetUserId: userId,
      details: { updatedFields: Object.keys(payload) },
      client: prisma,
    }).catch(() => {});
    return getProfile(userId);
  }

  async function getPreferences(userId) {
    if (!userId) throw rejected('ACCOUNT_NOT_FOUND');
    const raw = settingsRepository?.get ? await settingsRepository.get(`user_pref:${userId}`) : null;
    return { preferences: parseJsonSetting(raw, DEFAULT_USER_PREFS) };
  }

  async function updatePreferences(userId, payload = {}) {
    if (!userId) throw rejected('ACCOUNT_NOT_FOUND');
    const { preferences: current } = await getPreferences(userId);
    const next = { ...current };
    if (payload.theme === 'light' || payload.theme === 'dark') next.theme = payload.theme;
    if (payload.tableDensity === 'comfortable' || payload.tableDensity === 'compact') next.tableDensity = payload.tableDensity;
    if ([10, 15, 20, 25, 50].includes(Number(payload.pageSize))) next.pageSize = Number(payload.pageSize);
    for (const boolKey of [
      'sidebarCollapsed',
      'notifyNewMessage',
      'notifyNewBooking',
      'notifyBookingStatus',
      'notifyPayment',
      'notifyFleetMaintenance',
      'notifySystemAlert',
    ]) {
      if (typeof payload[boolKey] === 'boolean') next[boolKey] = payload[boolKey];
    }
    if (settingsRepository?.set) {
      await settingsRepository.set(`user_pref:${userId}`, JSON.stringify(next));
    }
    await activityLog.log({
      actor: userId,
      action: 'USER_PREFERENCES_UPDATED',
      resourceType: 'UserPreference',
      resourceId: userId,
      targetUserId: userId,
      client: prisma,
    }).catch(() => {});
    return { preferences: next };
  }

  async function resetPreferences(userId) {
    if (!userId) throw rejected('ACCOUNT_NOT_FOUND');
    const reset = { ...DEFAULT_USER_PREFS };
    if (settingsRepository?.set) {
      await settingsRepository.set(`user_pref:${userId}`, JSON.stringify(reset));
    }
    await activityLog.log({
      actor: userId,
      action: 'USER_PREFERENCES_RESET',
      resourceType: 'UserPreference',
      resourceId: userId,
      targetUserId: userId,
      client: prisma,
    }).catch(() => {});
    return { preferences: reset };
  }

  async function getMySessionsAndLogins(userId, currentSessionId = null) {
    if (!userId) throw rejected('ACCOUNT_NOT_FOUND');
    const [sessions, loginHistory] = await Promise.all([
      prisma.adminSession.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 15,
        select: {
          id: true,
          createdAt: true,
          lastActivityAt: true,
          idleExpiresAt: true,
          absoluteExpiresAt: true,
          revokedAt: true,
        },
      }),
      prisma.activityLog.findMany({
        where: { OR: [{ actor: userId }, { targetUserId: userId }] },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, action: true, resourceType: true, userAgent: true, createdAt: true },
      }),
    ]);
    return {
      sessions: sessions.map((s) => ({
        ...s,
        isCurrent: Boolean(currentSessionId && s.id === currentSessionId),
        isActive: !s.revokedAt && new Date(s.absoluteExpiresAt) > new Date(),
      })),
      loginHistory,
    };
  }

  async function revokeOtherSessions(userId, currentSessionId = null) {
    if (!userId) throw rejected('ACCOUNT_NOT_FOUND');
    const where = {
      userId,
      revokedAt: null,
      ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
    };
    const result = await prisma.adminSession.updateMany({
      where,
      data: { revokedAt: new Date() },
    });
    await activityLog.log({
      actor: userId,
      action: 'OTHER_SESSIONS_REVOKED',
      resourceType: 'AdminSession',
      resourceId: userId,
      targetUserId: userId,
      details: { revokedCount: result.count },
      client: prisma,
    }).catch(() => {});
    return { revokedCount: result.count };
  }

  return Object.freeze({
    getProfile,
    getMfaStatus,
    startMfaEnrollment,
    confirmMfaEnrollment,
    revokeMfaFactor,
    updateEmail,
    updateUsername,
    updateDisplayName,
    changePassword,
    updateProfileMeta,
    getPreferences,
    updatePreferences,
    resetPreferences,
    getMySessionsAndLogins,
    revokeOtherSessions,
  });
}
