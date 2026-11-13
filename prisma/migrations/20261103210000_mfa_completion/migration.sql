CREATE TABLE "MfaCompletion" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "proofHash" BYTEA NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MfaCompletion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MfaCompletion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MfaCompletion_proofHash_key" ON "MfaCompletion"("proofHash");
CREATE INDEX "MfaCompletion_userId_purpose_expiresAt_consumedAt_idx" ON "MfaCompletion"("userId", "purpose", "expiresAt", "consumedAt");
CREATE INDEX "MfaCompletion_expiresAt_idx" ON "MfaCompletion"("expiresAt");
