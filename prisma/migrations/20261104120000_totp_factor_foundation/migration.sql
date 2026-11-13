CREATE TYPE "TotpFactorStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

CREATE TABLE "TotpFactor" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "TotpFactorStatus" NOT NULL DEFAULT 'PENDING',
    "encryptedSecret" BYTEA NOT NULL,
    "secretNonce" BYTEA NOT NULL,
    "secretAuthTag" BYTEA NOT NULL,
    "encryptionKeyId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "lastAcceptedTimeStep" BIGINT,
    CONSTRAINT "TotpFactor_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TotpFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TotpFactor_encryptedSecret_length_check" CHECK (octet_length("encryptedSecret") = 20),
    CONSTRAINT "TotpFactor_secretNonce_length_check" CHECK (octet_length("secretNonce") = 12),
    CONSTRAINT "TotpFactor_secretAuthTag_length_check" CHECK (octet_length("secretAuthTag") = 16),
    CONSTRAINT "TotpFactor_encryptionKeyId_check" CHECK (length("encryptionKeyId") > 0),
    CONSTRAINT "TotpFactor_lastAcceptedTimeStep_check" CHECK ("lastAcceptedTimeStep" IS NULL OR "lastAcceptedTimeStep" >= 0)
);

CREATE INDEX "TotpFactor_userId_status_idx" ON "TotpFactor"("userId", "status");
CREATE UNIQUE INDEX "TotpFactor_one_pending_per_user_key" ON "TotpFactor"("userId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "TotpFactor_one_active_per_user_key" ON "TotpFactor"("userId") WHERE "status" = 'ACTIVE';
