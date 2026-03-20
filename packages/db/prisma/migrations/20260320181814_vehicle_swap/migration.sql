-- CreateEnum
CREATE TYPE "SwapReason" AS ENUM ('CUSTOMER_REQUEST', 'MAINTENANCE', 'UPGRADE', 'DOWNGRADE', 'DAMAGE', 'OTHER');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "requiresManagerConfirmation" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "VehicleCategory" ADD COLUMN     "rank" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "VehicleSwap" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "originalVehicleId" INTEGER NOT NULL,
    "newVehicleId" INTEGER NOT NULL,
    "swappedById" INTEGER NOT NULL,
    "reason" "SwapReason" NOT NULL,
    "reasonNotes" TEXT,
    "originalVehicleStatus" "VehicleStatus",
    "originalVehicleNotes" TEXT,
    "swappedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleSwap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehicleSwap_publicId_key" ON "VehicleSwap"("publicId");

-- CreateIndex
CREATE INDEX "VehicleSwap_bookingId_idx" ON "VehicleSwap"("bookingId");

-- CreateIndex
CREATE INDEX "VehicleSwap_originalVehicleId_idx" ON "VehicleSwap"("originalVehicleId");

-- CreateIndex
CREATE INDEX "VehicleSwap_newVehicleId_idx" ON "VehicleSwap"("newVehicleId");

-- CreateIndex
CREATE INDEX "VehicleSwap_swappedById_idx" ON "VehicleSwap"("swappedById");

-- CreateIndex
CREATE INDEX "VehicleSwap_swappedAt_idx" ON "VehicleSwap"("swappedAt");

-- CreateIndex
CREATE INDEX "VehicleSwap_reason_idx" ON "VehicleSwap"("reason");

-- AddForeignKey
ALTER TABLE "VehicleSwap" ADD CONSTRAINT "VehicleSwap_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSwap" ADD CONSTRAINT "VehicleSwap_originalVehicleId_fkey" FOREIGN KEY ("originalVehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSwap" ADD CONSTRAINT "VehicleSwap_newVehicleId_fkey" FOREIGN KEY ("newVehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSwap" ADD CONSTRAINT "VehicleSwap_swappedById_fkey" FOREIGN KEY ("swappedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
