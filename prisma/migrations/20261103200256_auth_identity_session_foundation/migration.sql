-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "passwordHash" TEXT,
    "status" "UserStatus" NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "assignedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    "grantedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "OIDCIdentity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OIDCIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idleExpiresAt" TIMESTAMPTZ(6) NOT NULL,
    "absoluteExpiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE INDEX "UserRole_roleId_userId_idx" ON "UserRole"("roleId", "userId");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_roleId_idx" ON "RolePermission"("permissionId", "roleId");

-- CreateIndex
CREATE INDEX "OIDCIdentity_userId_idx" ON "OIDCIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OIDCIdentity_issuer_subject_key" ON "OIDCIdentity"("issuer", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminSession_userId_revokedAt_idx" ON "AdminSession"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "AdminSession_idleExpiresAt_idx" ON "AdminSession"("idleExpiresAt");

-- CreateIndex
CREATE INDEX "AdminSession_absoluteExpiresAt_idx" ON "AdminSession"("absoluteExpiresAt");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OIDCIdentity" ADD CONSTRAINT "OIDCIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Keep identity normalization invariant for Prisma and direct SQL writes.
CREATE FUNCTION normalize_user_identifiers() RETURNS trigger AS $$
BEGIN
    NEW."email" := lower(btrim(NEW."email"));
    NEW."username" := lower(btrim(NEW."username"));
    IF TG_OP = 'UPDATE' THEN
        NEW."updatedAt" := CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "User_normalize_identifiers"
BEFORE INSERT OR UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION normalize_user_identifiers();

ALTER TABLE "User"
    ADD CONSTRAINT "User_email_normalized_check" CHECK ("email" <> '' AND "email" = lower(btrim("email"))),
    ADD CONSTRAINT "User_username_normalized_check" CHECK ("username" <> '' AND "username" = lower(btrim("username")));

ALTER TABLE "AdminSession"
    ADD CONSTRAINT "AdminSession_absolute_expiry_check" CHECK (
        "absoluteExpiresAt" > "createdAt"
        AND "absoluteExpiresAt" <= "createdAt" + INTERVAL '8 hours'
    ),
    ADD CONSTRAINT "AdminSession_activity_expiry_check" CHECK (
        "lastActivityAt" >= "createdAt"
        AND "lastActivityAt" <= "absoluteExpiresAt"
        AND "idleExpiresAt" > "lastActivityAt"
        AND "idleExpiresAt" <= "lastActivityAt" + INTERVAL '30 minutes'
        AND "idleExpiresAt" <= "absoluteExpiresAt"
    );

CREATE FUNCTION enforce_super_admin_role_exclusivity() RETURNS trigger AS $$
DECLARE
    is_super_admin BOOLEAN;
    has_existing_role BOOLEAN;
    has_super_admin BOOLEAN;
BEGIN
    IF TG_OP = 'UPDATE' AND OLD."userId" <> NEW."userId" THEN
        PERFORM 1 FROM "User"
        WHERE "id" IN (OLD."userId", NEW."userId")
        ORDER BY "id" FOR UPDATE;
    ELSE
        PERFORM 1 FROM "User" WHERE "id" = NEW."userId" FOR UPDATE;
    END IF;

    SELECT "code" = 'SUPER_ADMIN' INTO is_super_admin
    FROM "Role" WHERE "id" = NEW."roleId";

    SELECT EXISTS (
        SELECT 1 FROM "UserRole" ur
        WHERE ur."userId" = NEW."userId"
          AND (TG_OP <> 'UPDATE' OR (ur."userId", ur."roleId") <> (OLD."userId", OLD."roleId"))
    ) INTO has_existing_role;

    SELECT EXISTS (
        SELECT 1 FROM "UserRole" ur
        JOIN "Role" r ON r."id" = ur."roleId"
        WHERE ur."userId" = NEW."userId"
          AND r."code" = 'SUPER_ADMIN'
          AND (TG_OP <> 'UPDATE' OR (ur."userId", ur."roleId") <> (OLD."userId", OLD."roleId"))
    ) INTO has_super_admin;

    IF (is_super_admin AND has_existing_role) OR (NOT is_super_admin AND has_super_admin) THEN
        RAISE EXCEPTION 'SUPER_ADMIN role is exclusive per user'
            USING ERRCODE = '23514', CONSTRAINT = 'UserRole_super_admin_exclusive';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "UserRole_super_admin_exclusive"
BEFORE INSERT OR UPDATE ON "UserRole"
FOR EACH ROW EXECUTE FUNCTION enforce_super_admin_role_exclusivity();
