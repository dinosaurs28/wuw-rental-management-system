-- CreateEnum
CREATE TYPE "ExtensionStatus" AS ENUM ('PENDING_PAYMENT', 'PAYMENT_COLLECTED', 'CONFIRMED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExtensionTrigger" AS ENUM ('CUSTOMER_BEFORE_PICKUP', 'CUSTOMER_AFTER_PICKUP', 'EMPLOYEE_AT_PICKUP', 'EMPLOYEE_DURING_RENTAL');

-- CreateEnum
CREATE TYPE "ExtensionResolutionType" AS ENUM ('SAME_VEHICLE', 'SWAP_CURRENT_TO_OTHER', 'SWAP_FUTURE_BOOKING', 'PARTIAL_EXTENSION', 'NO_RESOLUTION');

-- AlterEnum
ALTER TYPE "StaffActionType" ADD VALUE 'EXTENDED';

-- AlterEnum
ALTER TYPE "StaffEntityType" ADD VALUE 'BOOKING_EXTENSION';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "activeExtensionId" INTEGER,
ADD COLUMN     "displacedByExtensionId" INTEGER,
ADD COLUMN     "extensionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "extensionDisplacedAt" TIMESTAMP(3),
ADD COLUMN     "lastExtendedAt" TIMESTAMP(3),
ADD COLUMN     "originalEndAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BookingExtension" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "extensionTrigger" "ExtensionTrigger" NOT NULL,
    "extensionStatus" "ExtensionStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "oldEndAt" TIMESTAMP(3) NOT NULL,
    "requestedEndAt" TIMESTAMP(3) NOT NULL,
    "actualNewEndAt" TIMESTAMP(3),
    "additionalAmount" DECIMAL(10,2) NOT NULL,
    "newTotalFinal" DECIMAL(10,2) NOT NULL,
    "resolutionType" "ExtensionResolutionType",
    "vehicleSwapOccurred" BOOLEAN NOT NULL DEFAULT false,
    "swappedVehicleId" INTEGER,
    "affectedBookingIds" INTEGER[],
    "paymentTransactionId" INTEGER,
    "vehicleSwapId" INTEGER,
    "actorId" INTEGER NOT NULL,
    "actorPublicId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "rejectionReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingExtension_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingExtension_publicId_key" ON "BookingExtension"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingExtension_paymentTransactionId_key" ON "BookingExtension"("paymentTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingExtension_vehicleSwapId_key" ON "BookingExtension"("vehicleSwapId");

-- CreateIndex
CREATE INDEX "BookingExtension_bookingId_idx" ON "BookingExtension"("bookingId");

-- CreateIndex
CREATE INDEX "BookingExtension_branchId_extensionStatus_idx" ON "BookingExtension"("branchId", "extensionStatus");

-- CreateIndex
CREATE INDEX "BookingExtension_actorId_idx" ON "BookingExtension"("actorId");

-- CreateIndex
CREATE INDEX "BookingExtension_createdAt_idx" ON "BookingExtension"("createdAt");

-- CreateIndex
CREATE INDEX "BookingExtension_extensionTrigger_idx" ON "BookingExtension"("extensionTrigger");

-- CreateIndex
CREATE INDEX "Booking_activeExtensionId_idx" ON "Booking"("activeExtensionId");

-- CreateIndex
CREATE INDEX "Booking_displacedByExtensionId_idx" ON "Booking"("displacedByExtensionId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_activeExtensionId_fkey" FOREIGN KEY ("activeExtensionId") REFERENCES "BookingExtension"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingExtension" ADD CONSTRAINT "BookingExtension_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingExtension" ADD CONSTRAINT "BookingExtension_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingExtension" ADD CONSTRAINT "BookingExtension_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingExtension" ADD CONSTRAINT "BookingExtension_swappedVehicleId_fkey" FOREIGN KEY ("swappedVehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingExtension" ADD CONSTRAINT "BookingExtension_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingExtension" ADD CONSTRAINT "BookingExtension_vehicleSwapId_fkey" FOREIGN KEY ("vehicleSwapId") REFERENCES "VehicleSwap"("id") ON DELETE SET NULL ON UPDATE CASCADE;
