CREATE TABLE "VehicleCategory" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VehicleCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VehicleModel" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "seatCount" INTEGER,
    "publicSpecs" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VehicleModel_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "VehicleModel_seatCount_check" CHECK ("seatCount" IS NULL OR "seatCount" BETWEEN 1 AND 200),
    CONSTRAINT "VehicleModel_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VehicleCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "VehicleRentalOption" (
    "modelId" UUID NOT NULL,
    "rentalType" VARCHAR(20) NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VehicleRentalOption_pkey" PRIMARY KEY ("modelId", "rentalType"),
    CONSTRAINT "VehicleRentalOption_rentalType_check" CHECK ("rentalType" IN ('self_drive', 'with_driver')),
    CONSTRAINT "VehicleRentalOption_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "VehicleModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VehicleRentalOption_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "VehicleCategory_slug_key" ON "VehicleCategory"("slug");
CREATE INDEX "VehicleCategory_isActive_sortOrder_name_idx" ON "VehicleCategory"("isActive", "sortOrder", "name");
CREATE UNIQUE INDEX "VehicleModel_slug_key" ON "VehicleModel"("slug");
CREATE INDEX "VehicleModel_categoryId_isActive_isVerified_name_idx" ON "VehicleModel"("categoryId", "isActive", "isVerified", "name");
CREATE INDEX "VehicleRentalOption_rentalType_isEnabled_idx" ON "VehicleRentalOption"("rentalType", "isEnabled");
