-- ActivityLog table for audit trail
CREATE TABLE "ActivityLog" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "action" VARCHAR(50) NOT NULL,
  "resourceType" VARCHAR(50),
  "resourceId" UUID,
  "targetUserId" UUID REFERENCES "User"("id") ON DELETE SET NULL,
  "details" JSONB,
  "ipAddress" VARCHAR(45),
  "userAgent" VARCHAR(500),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ActivityLog_actor_idx" ON "ActivityLog"("actor");
CREATE INDEX "ActivityLog_action_idx" ON "ActivityLog"("action");
CREATE INDEX "ActivityLog_targetUserId_idx" ON "ActivityLog"("targetUserId");
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");
CREATE INDEX "ActivityLog_actor_createdAt_idx" ON "ActivityLog"("actor", "createdAt");
