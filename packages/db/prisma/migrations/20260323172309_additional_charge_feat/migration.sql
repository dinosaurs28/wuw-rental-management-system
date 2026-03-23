-- CreateEnum
CREATE TYPE "GraceType" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('BASE', 'EXTRA_KM', 'EXTRA_TIME', 'FUEL_DEFICIT', 'FASTAG', 'DAMAGE', 'GRACE_ADJUSTMENT', 'SAFETY_DEPOSIT');

-- CreateEnum
CREATE TYPE "OverrideStatus" AS ENUM ('PENDING', 'APPROVED', 'AUTO_APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FuelLevel" AS ENUM ('EMPTY', 'QUARTER', 'HALF', 'THREE_QUARTER', 'FULL');

-- CreateEnum
CREATE TYPE "SafetyDepositStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CHARGED', 'REFUNDED');

-- AlterEnum
ALTER TYPE "AuditCategory" ADD VALUE 'CHARGE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StaffEntityType" ADD VALUE 'CHARGE_ENTRY';
ALTER TYPE "StaffEntityType" ADD VALUE 'CHARGE_OVERRIDE';
ALTER TYPE "StaffEntityType" ADD VALUE 'FUEL_RECORD';
ALTER TYPE "StaffEntityType" ADD VALUE 'SAFETY_DEPOSIT_REQUEST';
ALTER TYPE "StaffEntityType" ADD VALUE 'BRANCH_CHARGE_CONFIG';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "chargeConfigVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "frozenChargeConfig" JSONB;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "fastagNumber" TEXT,
ADD COLUMN     "hasFastag" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BranchChargeConfig" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "branchId" INTEGER NOT NULL,
    "extraKmEnabled" BOOLEAN NOT NULL DEFAULT true,
    "extraTimeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "fuelModuleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "fastagModuleEnabled" BOOLEAN NOT NULL DEFAULT false,
    "gracePolicyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "damageModuleEnabled" BOOLEAN NOT NULL DEFAULT true,
    "graceType" "GraceType" NOT NULL DEFAULT 'AUTOMATIC',
    "graceMinutes" INTEGER NOT NULL DEFAULT 15,
    "employeeOverrideEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxOverridePercent" DECIMAL(5,2),
    "overrideRequiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "overrideApprovalThreshold" DECIMAL(10,2),
    "safetyDepositEnabled" BOOLEAN NOT NULL DEFAULT false,
    "safetyDepositRequiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchChargeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeEntry" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "chargeType" "ChargeType" NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "originalAmount" DECIMAL(10,2) NOT NULL,
    "finalAmount" DECIMAL(10,2) NOT NULL,
    "quantity" DECIMAL(10,4),
    "unitRate" DECIMAL(10,2),
    "notes" TEXT,
    "isOverridden" BOOLEAN NOT NULL DEFAULT false,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeOverride" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "chargeEntryId" INTEGER NOT NULL,
    "originalAmount" DECIMAL(10,2) NOT NULL,
    "overriddenAmount" DECIMAL(10,2) NOT NULL,
    "waivedAmount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "OverrideStatus" NOT NULL DEFAULT 'PENDING',
    "actorId" INTEGER NOT NULL,
    "actorRole" "Role" NOT NULL,
    "approverId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargeOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelRecord" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "pickupFuelLevel" "FuelLevel" NOT NULL,
    "returnFuelLevel" "FuelLevel",
    "fuelDeficit" BOOLEAN NOT NULL DEFAULT false,
    "fuelDeficitCharge" DECIMAL(10,2),
    "skipReason" TEXT,
    "capturedByPickupId" INTEGER NOT NULL,
    "capturedByReturnId" INTEGER,
    "pickupAt" TIMESTAMP(3) NOT NULL,
    "returnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FuelRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyDepositRequest" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "requestedAmount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "SafetyDepositStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requestedById" INTEGER NOT NULL,
    "approvedById" INTEGER,
    "approvedAmount" DECIMAL(10,2),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyDepositRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BranchChargeConfig_publicId_key" ON "BranchChargeConfig"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchChargeConfig_branchId_key" ON "BranchChargeConfig"("branchId");

-- CreateIndex
CREATE INDEX "BranchChargeConfig_branchId_idx" ON "BranchChargeConfig"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeEntry_publicId_key" ON "ChargeEntry"("publicId");

-- CreateIndex
CREATE INDEX "ChargeEntry_bookingId_idx" ON "ChargeEntry"("bookingId");

-- CreateIndex
CREATE INDEX "ChargeEntry_chargeType_idx" ON "ChargeEntry"("chargeType");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeEntry_bookingId_moduleKey_key" ON "ChargeEntry"("bookingId", "moduleKey");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeOverride_publicId_key" ON "ChargeOverride"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeOverride_chargeEntryId_key" ON "ChargeOverride"("chargeEntryId");

-- CreateIndex
CREATE INDEX "ChargeOverride_bookingId_idx" ON "ChargeOverride"("bookingId");

-- CreateIndex
CREATE INDEX "ChargeOverride_actorId_createdAt_idx" ON "ChargeOverride"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "ChargeOverride_status_idx" ON "ChargeOverride"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FuelRecord_publicId_key" ON "FuelRecord"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "FuelRecord_bookingId_key" ON "FuelRecord"("bookingId");

-- CreateIndex
CREATE INDEX "FuelRecord_bookingId_idx" ON "FuelRecord"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyDepositRequest_publicId_key" ON "SafetyDepositRequest"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyDepositRequest_bookingId_key" ON "SafetyDepositRequest"("bookingId");

-- CreateIndex
CREATE INDEX "SafetyDepositRequest_bookingId_idx" ON "SafetyDepositRequest"("bookingId");

-- CreateIndex
CREATE INDEX "SafetyDepositRequest_status_idx" ON "SafetyDepositRequest"("status");

-- CreateIndex
CREATE INDEX "SafetyDepositRequest_requestedById_idx" ON "SafetyDepositRequest"("requestedById");

-- AddForeignKey
ALTER TABLE "BranchChargeConfig" ADD CONSTRAINT "BranchChargeConfig_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeEntry" ADD CONSTRAINT "ChargeEntry_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeEntry" ADD CONSTRAINT "ChargeEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeOverride" ADD CONSTRAINT "ChargeOverride_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeOverride" ADD CONSTRAINT "ChargeOverride_chargeEntryId_fkey" FOREIGN KEY ("chargeEntryId") REFERENCES "ChargeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeOverride" ADD CONSTRAINT "ChargeOverride_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeOverride" ADD CONSTRAINT "ChargeOverride_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelRecord" ADD CONSTRAINT "FuelRecord_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelRecord" ADD CONSTRAINT "FuelRecord_capturedByPickupId_fkey" FOREIGN KEY ("capturedByPickupId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelRecord" ADD CONSTRAINT "FuelRecord_capturedByReturnId_fkey" FOREIGN KEY ("capturedByReturnId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyDepositRequest" ADD CONSTRAINT "SafetyDepositRequest_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyDepositRequest" ADD CONSTRAINT "SafetyDepositRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyDepositRequest" ADD CONSTRAINT "SafetyDepositRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
