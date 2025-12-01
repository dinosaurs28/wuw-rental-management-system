/*
  Warnings:

  - You are about to drop the column `baseHalfDayPrice` on the `Vehicle` table. All the data in the column will be lost.
  - You are about to drop the column `baseHourlyPrice` on the `Vehicle` table. All the data in the column will be lost.
  - Changed the type of `provider` on the `UserProvider` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "UserProvider" DROP COLUMN "provider",
ADD COLUMN     "provider" "AuthProvider" NOT NULL;

-- AlterTable
ALTER TABLE "Vehicle" DROP COLUMN "baseHalfDayPrice",
DROP COLUMN "baseHourlyPrice",
ALTER COLUMN "baseDailyPrice" SET DEFAULT 500;

-- CreateTable
CREATE TABLE "BranchPricingSetting" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "weekendEnabled" BOOLEAN NOT NULL DEFAULT true,
    "peakEnabled" BOOLEAN NOT NULL DEFAULT false,
    "customEnabled" BOOLEAN NOT NULL DEFAULT false,
    "weekendMultiplier" DECIMAL(65,30) NOT NULL DEFAULT 1.2,
    "peakMultiplier" DECIMAL(65,30) NOT NULL DEFAULT 1.5,
    "customMultiplier" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchPricingSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehiclePricingOverride" (
    "id" SERIAL NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "customPrice" DECIMAL(65,30),
    "multiplier" DECIMAL(65,30),
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "VehiclePricingOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BranchPricingSetting_branchId_key" ON "BranchPricingSetting"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "VehiclePricingOverride_vehicleId_key" ON "VehiclePricingOverride"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "provider_providerUserId_unique" ON "UserProvider"("provider", "providerUserId");

-- AddForeignKey
ALTER TABLE "BranchPricingSetting" ADD CONSTRAINT "BranchPricingSetting_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehiclePricingOverride" ADD CONSTRAINT "VehiclePricingOverride_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
