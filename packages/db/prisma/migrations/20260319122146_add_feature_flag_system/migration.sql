/*
  Warnings:

  - You are about to drop the column `chargeType` on the `DamageReport` table. All the data in the column will be lost.
  - You are about to drop the column `chargeType` on the `InvoiceItem` table. All the data in the column will be lost.
  - You are about to drop the column `isTaxable` on the `InvoiceItem` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "FeatureFlagScope" AS ENUM ('SYSTEM', 'BRANCH', 'VEHICLE');

-- DropIndex
DROP INDEX "DamageReport_bookingId_idx";

-- DropIndex
DROP INDEX "DamageReport_chargeType_idx";

-- DropIndex
DROP INDEX "DamageReport_status_idx";

-- DropIndex
DROP INDEX "DamageReport_vehicleId_idx";

-- DropIndex
DROP INDEX "InvoiceItem_chargeType_idx";

-- DropIndex
DROP INDEX "InvoiceItem_invoiceId_idx";

-- AlterTable
ALTER TABLE "DamageReport" DROP COLUMN "chargeType";

-- AlterTable
ALTER TABLE "InvoiceItem" DROP COLUMN "chargeType",
DROP COLUMN "isTaxable";

-- DropEnum
DROP TYPE "ChargeType";

-- DropEnum
DROP TYPE "DamageChargeType";

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" "FeatureFlagScope" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchFeatureFlag" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "flagId" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchFeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleFeatureFlag" (
    "id" SERIAL NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "flagId" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleFeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_publicId_key" ON "FeatureFlag"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- CreateIndex
CREATE INDEX "FeatureFlag_key_idx" ON "FeatureFlag"("key");

-- CreateIndex
CREATE INDEX "FeatureFlag_scope_idx" ON "FeatureFlag"("scope");

-- CreateIndex
CREATE INDEX "FeatureFlag_enabled_idx" ON "FeatureFlag"("enabled");

-- CreateIndex
CREATE INDEX "BranchFeatureFlag_branchId_idx" ON "BranchFeatureFlag"("branchId");

-- CreateIndex
CREATE INDEX "BranchFeatureFlag_flagId_idx" ON "BranchFeatureFlag"("flagId");

-- CreateIndex
CREATE INDEX "BranchFeatureFlag_enabled_idx" ON "BranchFeatureFlag"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "BranchFeatureFlag_branchId_flagId_key" ON "BranchFeatureFlag"("branchId", "flagId");

-- CreateIndex
CREATE INDEX "VehicleFeatureFlag_vehicleId_idx" ON "VehicleFeatureFlag"("vehicleId");

-- CreateIndex
CREATE INDEX "VehicleFeatureFlag_flagId_idx" ON "VehicleFeatureFlag"("flagId");

-- CreateIndex
CREATE INDEX "VehicleFeatureFlag_enabled_idx" ON "VehicleFeatureFlag"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleFeatureFlag_vehicleId_flagId_key" ON "VehicleFeatureFlag"("vehicleId", "flagId");

-- AddForeignKey
ALTER TABLE "BranchFeatureFlag" ADD CONSTRAINT "BranchFeatureFlag_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchFeatureFlag" ADD CONSTRAINT "BranchFeatureFlag_flagId_fkey" FOREIGN KEY ("flagId") REFERENCES "FeatureFlag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleFeatureFlag" ADD CONSTRAINT "VehicleFeatureFlag_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleFeatureFlag" ADD CONSTRAINT "VehicleFeatureFlag_flagId_fkey" FOREIGN KEY ("flagId") REFERENCES "FeatureFlag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
