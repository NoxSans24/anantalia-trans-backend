import express from 'express';

export function createProfileRouter({ myProfileService, logger } = {}) {
  if (!myProfileService || !logger) throw new TypeError('Profile router dependencies required');

  const router = express.Router();

  function sendError(res, error) {
    const code = error?.status ?? 'INTERNAL_ERROR';
    const status = code === 'ACCOUNT_NOT_FOUND' ? 404
      : code === 'EMAIL_VERIFICATION_REQUIRED' ? 501
      : code === 'MFA_NOT_CONFIGURED' ? 503
      : code === 'PROFILE_VALUE_IN_USE' || code === 'PROFILE_UPDATE_CONFLICT' ? 409
      : code === 'INVALID_PROFILE_VALUE' || code === 'CURRENT_PASSWORD_INVALID' || code === 'MFA_VERIFICATION_FAILED' || code === 'MFA_REVOCATION_FAILED' || code === 'MFA_ENROLLMENT_FAILED' ? 400 : 500;
    return res.status(status).json({ error: { code } });
  }

  router.get('/me', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });

      const profile = await myProfileService.getProfile(userId);
      return res.status(200).json(profile);
    } catch (error) {
      logger?.error?.('profile_get_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.get('/me/mfa/status', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });

      const status = await myProfileService.getMfaStatus(userId);
      return res.status(200).json(status);
    } catch (error) {
      logger?.error?.('profile_mfa_status_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.post('/me/mfa/totp/enroll', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });

      const enrollment = await myProfileService.startMfaEnrollment(userId);
      return res.status(200).json(enrollment);
    } catch (error) {
      logger?.error?.('profile_mfa_enroll_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.post('/me/mfa/totp/confirm', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });

      const { factorId, code } = req.body ?? {};
      const confirmed = await myProfileService.confirmMfaEnrollment(userId, { factorId, code });
      return res.status(200).json(confirmed);
    } catch (error) {
      logger?.error?.('profile_mfa_confirm_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.post('/me/mfa/totp/revoke', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });

      const { factorId } = req.body ?? {};
      const revoked = await myProfileService.revokeMfaFactor(userId, { factorId });
      return res.status(200).json(revoked);
    } catch (error) {
      logger?.error?.('profile_mfa_revoke_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.post('/me/email', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });

      const { email } = req.body;
      const updated = await myProfileService.updateEmail(userId, email);
      return res.status(200).json(updated);
    } catch (error) {
      logger?.error?.('profile_email_update_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.post('/me/username', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });

      const { username } = req.body;
      const updated = await myProfileService.updateUsername(userId, username);
      return res.status(200).json(updated);
    } catch (error) {
      logger?.error?.('profile_username_update_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.post('/me/displayName', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });

      const { displayName } = req.body;
      const updated = await myProfileService.updateDisplayName(userId, displayName);
      return res.status(200).json(updated);
    } catch (error) {
      logger?.error?.('profile_display_name_update_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.post('/me/password', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });

      const { oldPassword, newPassword } = req.body;
      const { verifyPassword } = await import('../auth/password-service.js');
      const result = await myProfileService.changePassword(userId, oldPassword, newPassword, verifyPassword);
      return res.status(200).json(result);
    } catch (error) {
      logger?.error?.('profile_password_change_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.patch('/me/meta', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
      const updated = await myProfileService.updateProfileMeta(userId, req.body ?? {});
      return res.status(200).json(updated);
    } catch (error) {
      logger?.error?.('profile_meta_update_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.get('/me/preferences', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
      const result = await myProfileService.getPreferences(userId);
      return res.status(200).json(result);
    } catch (error) {
      logger?.error?.('profile_preferences_get_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.put('/me/preferences', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
      const result = await myProfileService.updatePreferences(userId, req.body ?? {});
      return res.status(200).json(result);
    } catch (error) {
      logger?.error?.('profile_preferences_update_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.post('/me/preferences/reset', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
      const result = await myProfileService.resetPreferences(userId);
      return res.status(200).json(result);
    } catch (error) {
      logger?.error?.('profile_preferences_reset_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.get('/me/sessions', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
      const result = await myProfileService.getMySessionsAndLogins(userId, req.sessionId ?? null);
      return res.status(200).json(result);
    } catch (error) {
      logger?.error?.('profile_sessions_get_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  router.post('/me/sessions/revoke-others', async (req, res) => {
    try {
      const userId = req.userId;
      if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
      const result = await myProfileService.revokeOtherSessions(userId, req.sessionId ?? null);
      return res.status(200).json(result);
    } catch (error) {
      logger?.error?.('profile_sessions_revoke_others_failed', { requestId: req.id });
      return sendError(res, error);
    }
  });

  return router;
}
