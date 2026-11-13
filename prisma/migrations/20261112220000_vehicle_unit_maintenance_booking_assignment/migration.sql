CREATE TABLE "VehicleUnit" (
    "id" UUID NOT NULL,
    "modelId" UUID NOT NULL,
    "plateNumber" VARCHAR(24) NOT NULL,
    "year" INTEGER NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'available',
    "odometerKm" INTEGER,
    "lastServiceDate" VARCHAR(10),
    "nextServiceDate" VARCHAR(10),
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VehicleUnit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "VehicleUnit_plateNumber_check" CHECK (btrim("plateNumber") <> ''),
    CONSTRAINT "VehicleUnit_year_check" CHECK ("year" BETWEEN 1990 AND 2035),
    CONSTRAINT "VehicleUnit_status_check" CHECK ("status" IN ('available', 'in_use', 'maintenance', 'inactive')),
    CONSTRAINT "VehicleUnit_odometerKm_check" CHECK ("odometerKm" IS NULL OR "odometerKm" >= 0),
    CONSTRAINT "VehicleUnit_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "VehicleModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "VehicleMaintenance" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "serviceType" VARCHAR(100) NOT NULL,
    "serviceDate" VARCHAR(10) NOT NULL,
    "odometerKm" INTEGER,
    "costAmount" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(24) NOT NULL DEFAULT 'scheduled',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VehicleMaintenance_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "VehicleMaintenance_serviceType_check" CHECK (btrim("serviceType") <> ''),
    CONSTRAINT "VehicleMaintenance_costAmount_check" CHECK ("costAmount" >= 0),
    CONSTRAINT "VehicleMaintenance_odometerKm_check" CHECK ("odometerKm" IS NULL OR "odometerKm" >= 0),
    CONSTRAINT "VehicleMaintenance_status_check" CHECK ("status" IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
    CONSTRAINT "VehicleMaintenance_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "VehicleUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "BookingUnitAssignment" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'assigned',
    "assignedBy" UUID,
    "assignedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(6),
    "notes" TEXT,
    CONSTRAINT "BookingUnitAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BookingUnitAssignment_status_check" CHECK ("status" IN ('assigned', 'released', 'replaced', 'cancelled')),
    CONSTRAINT "BookingUnitAssignment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BookingUnitAssignment_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "VehicleUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "VehicleUnit_plateNumber_key" ON "VehicleUnit"("plateNumber");
CREATE INDEX "VehicleUnit_modelId_status_isActive_idx" ON "VehicleUnit"("modelId", "status", "isActive");
CREATE INDEX "VehicleUnit_nextServiceDate_idx" ON "VehicleUnit"("nextServiceDate");
CREATE INDEX "VehicleMaintenance_unitId_serviceDate_idx" ON "VehicleMaintenance"("unitId", "serviceDate");
CREATE INDEX "VehicleMaintenance_status_serviceDate_idx" ON "VehicleMaintenance"("status", "serviceDate");
CREATE INDEX "BookingUnitAssignment_bookingId_status_idx" ON "BookingUnitAssignment"("bookingId", "status");
CREATE INDEX "BookingUnitAssignment_unitId_status_idx" ON "BookingUnitAssignment"("unitId", "status");
