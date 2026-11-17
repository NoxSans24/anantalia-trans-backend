import { createApp } from './app.js';
import { createAuthenticationOrchestrationService } from './auth/authentication-orchestration-service.js';
import { createLocalLoginService } from './auth/local-login-service.js';
import { createMfaChallengeService } from './auth/mfa-challenge-service.js';
import { createMfaVerificationService } from './auth/mfa-verification-service.js';
import { createHttpSessionAdapter } from './auth/http-session-adapter.js';
import { createPrismaMfaCompletionRepository } from './auth/prisma-mfa-completion.repository.js';
import { createPrismaMfaChallengeRepository } from './auth/prisma-mfa-challenge.repository.js';
import { createPrismaSessionRepository } from './auth/prisma-session.repository.js';
import { createPrismaTotpFactorRepository } from './auth/prisma-totp-factor.repository.js';
import { createPrismaUserRepository } from './auth/prisma-user.repository.js';
import { createSessionService } from './auth/session-service.js';
import { createTotpFactorService } from './auth/totp-factor-service.js';
import { createTotpKeyringProvider } from './auth/totp-keyring-provider.js';
import { createAuthorizationService } from './auth/authorization-service.js';
import { createCurrentPrincipalService } from './auth/current-principal-service.js';
import { createActivityLogService } from './auth/activity-log-service.js';
import { createAdminAccountService } from './auth/admin-account-service.js';
import { createAccountLifecycleService } from './auth/account-lifecycle-service.js';
import { createMyProfileService } from './auth/my-profile-service.js';
import { createCsrfMiddleware } from './middlewares/csrf.middleware.js';
import { createRateLimitMiddleware } from './middlewares/rate-limit.middleware.js';
import { createAuthenticationMiddleware } from './middlewares/auth.middleware.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createAdminAccountRouter } from './routes/admin-account.routes.js';
import { createProfileRouter } from './routes/profile.routes.js';
import { createPublicFleetRouter, createAdminFleetRouter } from './fleet/fleet.routes.js';
import { createFleetService } from './fleet/fleet.service.js';
import { createPublicContentRouter } from './content/public-content.routes.js';
import { createPublicContactRouter } from './inbox/public-contact.routes.js';
import { createPrismaFleetRepository } from './fleet/prisma-fleet.repository.js';
import { createDashboardService } from './dashboard/dashboard.service.js';
import { createPrismaDashboardRepository } from './dashboard/prisma-dashboard.repository.js';
import { createDashboardRouter } from './dashboard/dashboard.routes.js';
import { createBookingService } from './booking/booking.service.js';
import { createPublicBookingRouter, createAdminBookingRouter } from './booking/booking.routes.js';
import { createPrismaBookingRepository } from './booking/prisma-booking.repository.js';
import { createCustomerService } from './customer/customer.service.js';
import { createCustomerRouter } from './customer/customer.routes.js';
import { createPrismaCustomerRepository } from './customer/prisma-customer.repository.js';
import { createPricingService } from './pricing/pricing.service.js';
import { createPricingRouter } from './pricing/pricing.routes.js';
import { createPrismaPricingRepository } from './pricing/prisma-pricing.repository.js';
import { createFinanceService } from './finance/finance.service.js';
import { createFinanceRouter } from './finance/finance.routes.js';
import { createPrismaFinanceRepository } from './finance/prisma-finance.repository.js';
import { createInboxService } from './inbox/inbox.service.js';
import { createInboxRouter } from './inbox/inbox.routes.js';
import { createPrismaInboxRepository } from './inbox/prisma-inbox.repository.js';
import { createContentService } from './content/content.service.js';
import { createContentRouter } from './content/content.routes.js';
import { createPrismaContentRepository } from './content/prisma-content.repository.js';
import { createAnalyticsService } from './analytics/analytics.service.js';
import { createAnalyticsRouter } from './analytics/analytics.routes.js';
import { createPrismaAnalyticsRepository } from './analytics/prisma-analytics.repository.js';
import { createSettingsService } from './settings/settings.service.js';
import { createSettingsRouter } from './settings/settings.routes.js';
import { createPrismaSettingsRepository } from './settings/prisma-settings.repository.js';
import { validateEnv } from './config/env.js';
import { logger } from './lib/logger.js';
import { createPrismaClient } from './lib/prisma.js';
import { verifyPassword, hashPassword, validatePasswordConfiguration } from './auth/password-service.js';

const config = validateEnv();
const prisma = createPrismaClient(config.databaseUrl);
const authService = createAuthorizationService({ prisma });
const activityLog = createActivityLogService({ prisma });
const settingsRepository = createPrismaSettingsRepository(prisma);
const fleetService = createFleetService({ repository: createPrismaFleetRepository(prisma), authorizationService: authService, activityLog, settingsRepository });
const publicFleetRouter = createPublicFleetRouter({ fleetService, logger });
const rateLimitMiddleware = createRateLimitMiddleware();
const pricingRepository = createPrismaPricingRepository(prisma);
const bookingRepository = createPrismaBookingRepository(prisma);
const bookingService = createBookingService({
  repository: bookingRepository,
  authorizationService: authService,
  activityLog,
  fleetService,
  pricingRepository,
  settingsRepository,
});
const publicBookingRouter = createPublicBookingRouter({ bookingService, rateLimitMiddleware, logger });
const contentRepository = createPrismaContentRepository(prisma);
const settingsService = createSettingsService({ repository: settingsRepository, authorizationService: authService, activityLog, prisma });
const contentService = createContentService({ repository: contentRepository, authorizationService: authService, activityLog, settingsRepository });
const publicContentRouter = createPublicContentRouter({ contentService, settingsService, logger });
const inboxRepository = createPrismaInboxRepository(prisma);
const inboxService = createInboxService({ repository: inboxRepository, authorizationService: authService, activityLog, settingsRepository });
const publicContactRouter = createPublicContactRouter({ inboxService, rateLimitMiddleware, logger });

const keyringProvider = createTotpKeyringProvider({
  loadKeyring: async () => {
    const activeKeyId = process.env.TOTP_ACTIVE_KEY_ID;
    const configuredKeys = JSON.parse(process.env.TOTP_KEYRING ?? 'null');
    if (!activeKeyId || !configuredKeys || typeof configuredKeys !== 'object' || Array.isArray(configuredKeys)) return null;
    const keys = Object.fromEntries(Object.entries(configuredKeys).map(([id, encoded]) => {
      if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw new Error('Invalid keyring');
      const key = Buffer.from(encoded, 'base64url');
      if (key.length !== 32 || key.toString('base64url') !== encoded) throw new Error('Invalid keyring');
      return [id, key];
    }));
    return { activeKeyId, keys };
  },
});
let totpFactorService = null;
const encryption = await keyringProvider.load();
if (encryption) {
  try {
    totpFactorService = createTotpFactorService({
      repository: createPrismaTotpFactorRepository(prisma),
      encryption,
    });
  } catch {}
}

let authRouter = null;
let adminAccountRouter = null;
let profileRouter = null;
let adminFleetRouter = null;
let dashboardRouter = null;
let adminBookingRouter = null;
let customerRouter = null;
let pricingRouter = null;
let financeRouter = null;
let inboxRouter = null;
let contentRouter = null;
let analyticsRouter = null;
let settingsRouter = null;
let authenticationMiddleware = null;
const csrfSecret = process.env.CSRF_SECRET;
let csrfMiddleware = null;
let passwordConfigurationValid = false;
try {
  validatePasswordConfiguration();
  passwordConfigurationValid = true;
} catch {
  logger.error('auth_routes_disabled_invalid_password_config');
}
try {
  if (csrfSecret) csrfMiddleware = createCsrfMiddleware({ secret: csrfSecret });
} catch {
  logger.error('auth_routes_disabled_invalid_csrf_secret');
}

if (totpFactorService && csrfMiddleware && passwordConfigurationValid) {
  const userRepository = createPrismaUserRepository(prisma);
  const sessionRepository = createPrismaSessionRepository(prisma);
  const sessionService = createSessionService({ repository: sessionRepository });
  const accountLifecycleService = createAccountLifecycleService({ prisma, userRepository, sessionRepository, activityLog });
  const completionRepository = createPrismaMfaCompletionRepository(prisma, { verifyFactor: totpFactorService.verifyCode });
  const mfaVerificationService = createMfaVerificationService({ completionRepository });
  const authenticationOrchestrationService = createAuthenticationOrchestrationService({
    localLogin: createLocalLoginService({ userRepository, passwordVerifier: verifyPassword }),
    challengeService: createMfaChallengeService({ repository: createPrismaMfaChallengeRepository(prisma) }),
    mfaVerificationService,
    sessionService,
  });
  const sessionAdapter = createHttpSessionAdapter({ sessionService });

  authRouter = createAuthRouter({
    orchestration: authenticationOrchestrationService,
    sessionService,
    sessionAdapter,
    principalService: createCurrentPrincipalService({ prisma }),
    csrfMiddleware,
    rateLimitMiddleware,
    logger,
  });

  authenticationMiddleware = createAuthenticationMiddleware({ sessionAdapter });

  const adminAccountService = createAdminAccountService({ prisma, authService, activityLog, accountLifecycleService, passwordService: { hash: hashPassword } });
  adminAccountRouter = createAdminAccountRouter({ adminAccountService, authService, activityLog, logger });

  const myProfileService = createMyProfileService({ prisma, passwordService: { hash: hashPassword }, activityLog, totpFactorService, settingsRepository });
  profileRouter = createProfileRouter({ myProfileService, logger });
  adminFleetRouter = createAdminFleetRouter({ fleetService, logger });
  dashboardRouter = createDashboardRouter({ dashboardService: createDashboardService({ repository: createPrismaDashboardRepository(prisma), authorizationService: authService }), logger });

  adminBookingRouter = createAdminBookingRouter({ bookingService, logger });
  const customerRepository = createPrismaCustomerRepository(prisma);
  customerRouter = createCustomerRouter({ customerService: createCustomerService({ repository: customerRepository, authorizationService: authService, activityLog }), logger });
  pricingRouter = createPricingRouter({ pricingService: createPricingService({ repository: pricingRepository, authorizationService: authService, activityLog, settingsRepository }), logger });
  const financeRepository = createPrismaFinanceRepository(prisma);
  financeRouter = createFinanceRouter({ financeService: createFinanceService({ repository: financeRepository, authorizationService: authService, activityLog }), logger });
  inboxRouter = createInboxRouter({ inboxService, logger });
  contentRouter = createContentRouter({ contentService, logger });
  const analyticsRepository = createPrismaAnalyticsRepository(prisma);
  analyticsRouter = createAnalyticsRouter({ analyticsService: createAnalyticsService({ repository: analyticsRepository, authorizationService: authService }), logger });
  settingsRouter = createSettingsRouter({ settingsService, logger });
}

const server = createApp({
  prisma,
  logger,
  authRouter,
  adminAccountRouter,
  profileRouter,
  publicFleetRouter,
  adminFleetRouter,
  dashboardRouter,
  publicBookingRouter,
  publicContentRouter,
  publicContactRouter,
  adminBookingRouter,
  customerRouter,
  pricingRouter,
  financeRouter,
  inboxRouter,
  contentRouter,
  analyticsRouter,
  settingsRouter,
  authenticationMiddleware,
  csrfMiddleware,
  trustProxy: config.trustProxy,
}).listen(config.port, config.host, () => {
  logger.info('server_started');
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server_stopping');
  server.close(async (error) => {
    try {
      await prisma.$disconnect();
      logger.info('server_stopped');
      if (error) process.exitCode = 1;
    } catch {
      process.exitCode = 1;
    }
  });
  const timeout = setTimeout(() => {
    server.closeAllConnections();
    process.exitCode = 1;
  }, 10_000);
  timeout.unref();
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
