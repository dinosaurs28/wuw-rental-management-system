/*
  Warnings:

  - You are about to drop the column `depositRequired` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `rentalPlanId` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `rentalPrice` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `vehicleId` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the `RentalPlan` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[transactionId]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `days` to the `Booking` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalBase` to the `Booking` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalDeposit` to the `Booking` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalDiscount` to the `Booking` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalFinal` to the `Booking` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_rentalPlanId_fkey";

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_vehicleId_fkey";

-- DropIndex
DROP INDEX "Booking_vehicleId_idx";

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "depositRequired",
DROP COLUMN "rentalPlanId",
DROP COLUMN "rentalPrice",
DROP COLUMN "vehicleId",
ADD COLUMN     "days" INTEGER NOT NULL,
ADD COLUMN     "holdExpiresAt" TIMESTAMP(3),
ADD COLUMN     "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
ADD COLUMN     "totalBase" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "totalDeposit" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "totalDiscount" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "totalFinal" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "transactionId" TEXT,
ALTER COLUMN "depositMethod" DROP NOT NULL;

-- DropTable
DROP TABLE "RentalPlan";

-- CreateTable
CREATE TABLE "BookingItem" (
    "id" SERIAL NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "days" INTEGER NOT NULL,
    "baseTotal" DECIMAL(65,30) NOT NULL,
    "discountAmount" DECIMAL(65,30) NOT NULL,
    "discountPercent" DECIMAL(65,30) NOT NULL,
    "deposit" DECIMAL(65,30) NOT NULL,
    "finalTotal" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "BookingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingItem_bookingId_idx" ON "BookingItem"("bookingId");

-- CreateIndex
CREATE INDEX "BookingItem_vehicleId_idx" ON "BookingItem"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_transactionId_key" ON "Booking"("transactionId");

-- AddForeignKey
ALTER TABLE "BookingItem" ADD CONSTRAINT "BookingItem_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingItem" ADD CONSTRAINT "BookingItem_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
