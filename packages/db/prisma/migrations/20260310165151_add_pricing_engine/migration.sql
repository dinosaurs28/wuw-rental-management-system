-- CreateEnum
CREATE TYPE "RentalPeriodType" AS ENUM ('HOURLY', 'HALF_DAY', 'FULL_DAY', 'MULTI_DAY', 'MONTHLY');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "actualHours" DECIMAL(65,30),
ADD COLUMN     "billableHours" DECIMAL(65,30),
ADD COLUMN     "endOdometer" INTEGER,
ADD COLUMN     "extraKmCharged" INTEGER,
ADD COLUMN     "freeKmLimit" INTEGER,
ADD COLUMN     "rentalPeriodType" "RentalPeriodType",
ADD COLUMN     "startOdometer" INTEGER,
ADD COLUMN     "totalKmDriven" INTEGER;

-- CreateTable
CREATE TABLE "VehicleCustomPricing" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "hourlyRate" DECIMAL(65,30),
    "price12Hour" DECIMAL(65,30),
    "freeKm12Hour" INTEGER NOT NULL DEFAULT 100,
    "price24Hour" DECIMAL(65,30) NOT NULL,
    "freeKm24Hour" INTEGER NOT NULL DEFAULT 150,
    "priceMonthly" DECIMAL(65,30),
    "freeKmMonthly" INTEGER NOT NULL DEFAULT 1500,
    "extraKmRate" DECIMAL(65,30) NOT NULL DEFAULT 8.00,
    "extraHourRate" DECIMAL(65,30) NOT NULL DEFAULT 100.00,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleCustomPricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchPricingDefaults" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "branchId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "hourlyRate" DECIMAL(65,30),
    "price12Hour" DECIMAL(65,30),
    "freeKm12Hour" INTEGER NOT NULL DEFAULT 100,
    "price24Hour" DECIMAL(65,30) NOT NULL,
    "freeKm24Hour" INTEGER NOT NULL DEFAULT 150,
    "priceMonthly" DECIMAL(65,30),
    "freeKmMonthly" INTEGER NOT NULL DEFAULT 1500,
    "extraKmRate" DECIMAL(65,30) NOT NULL DEFAULT 8.00,
    "extraHourRate" DECIMAL(65,30) NOT NULL DEFAULT 100.00,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchPricingDefaults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCustomPricing_publicId_key" ON "VehicleCustomPricing"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCustomPricing_vehicleId_key" ON "VehicleCustomPricing"("vehicleId");

-- CreateIndex
CREATE INDEX "VehicleCustomPricing_vehicleId_idx" ON "VehicleCustomPricing"("vehicleId");

-- CreateIndex
CREATE INDEX "VehicleCustomPricing_enabled_idx" ON "VehicleCustomPricing"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "BranchPricingDefaults_publicId_key" ON "BranchPricingDefaults"("publicId");

-- CreateIndex
CREATE INDEX "BranchPricingDefaults_branchId_idx" ON "BranchPricingDefaults"("branchId");

-- CreateIndex
CREATE INDEX "BranchPricingDefaults_categoryId_idx" ON "BranchPricingDefaults"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchPricingDefaults_branchId_categoryId_key" ON "BranchPricingDefaults"("branchId", "categoryId");

-- CreateIndex
CREATE INDEX "Booking_rentalPeriodType_idx" ON "Booking"("rentalPeriodType");

-- AddForeignKey
ALTER TABLE "VehicleCustomPricing" ADD CONSTRAINT "VehicleCustomPricing_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchPricingDefaults" ADD CONSTRAINT "BranchPricingDefaults_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchPricingDefaults" ADD CONSTRAINT "BranchPricingDefaults_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VehicleCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
