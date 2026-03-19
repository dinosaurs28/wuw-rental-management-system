-- CreateEnum
CREATE TYPE "DamageChargeType" AS ENUM ('PENALTY', 'COMPENSATION');

-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('RENTAL', 'DAMAGE_PENALTY', 'DAMAGE_COMPENSATION', 'DISTANCE', 'DELAY', 'FUEL', 'CLEANING', 'SPEEDING', 'OTHER');

-- AlterTable
ALTER TABLE "DamageReport" ADD COLUMN     "chargeType" "DamageChargeType" NOT NULL DEFAULT 'PENALTY';

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "chargeType" "ChargeType" NOT NULL DEFAULT 'RENTAL',
ADD COLUMN     "isTaxable" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "DamageReport_bookingId_idx" ON "DamageReport"("bookingId");

-- CreateIndex
CREATE INDEX "DamageReport_vehicleId_idx" ON "DamageReport"("vehicleId");

-- CreateIndex
CREATE INDEX "DamageReport_status_idx" ON "DamageReport"("status");

-- CreateIndex
CREATE INDEX "DamageReport_chargeType_idx" ON "DamageReport"("chargeType");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceItem_chargeType_idx" ON "InvoiceItem"("chargeType");
