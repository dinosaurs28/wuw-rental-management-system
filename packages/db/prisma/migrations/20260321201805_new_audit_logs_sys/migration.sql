/*
  Warnings:

  - You are about to drop the column `userId` on the `AuditLog` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[remainingPaymentId]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('BOOKING', 'PAYMENT', 'VEHICLE', 'CUSTOMER', 'EMPLOYEE', 'BRANCH', 'AUTH', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";

-- AlterTable
ALTER TABLE "AuditLog" DROP COLUMN "userId",
ADD COLUMN     "actorBranchId" INTEGER,
ADD COLUMN     "actorId" INTEGER,
ADD COLUMN     "actorName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "actorRole" "Role" NOT NULL DEFAULT 'CUSTOMER',
ADD COLUMN     "approverId" INTEGER,
ADD COLUMN     "approverName" TEXT,
ADD COLUMN     "approverRole" "Role",
ADD COLUMN     "category" "AuditCategory" NOT NULL DEFAULT 'SYSTEM',
ADD COLUMN     "changedFields" TEXT[],
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "entityLabel" TEXT,
ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "requestId" TEXT,
ADD COLUMN     "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "isAdvancePayment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "remainingBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "remainingPaidAt" TIMESTAMP(3),
ADD COLUMN     "remainingPaidDuring" TEXT,
ADD COLUMN     "remainingPaymentId" TEXT,
ADD COLUMN     "remainingPaymentMode" "DepositMethod";

-- AlterTable
ALTER TABLE "BookingPhoto" ADD COLUMN     "captureLabel" TEXT;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "advancePayAmount" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "VehiclePhotoCaptureConfig" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "branchId" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "fields" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehiclePhotoCaptureConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VehiclePhotoCaptureConfig_publicId_key" ON "VehiclePhotoCaptureConfig"("publicId");

-- CreateIndex
CREATE INDEX "VehiclePhotoCaptureConfig_branchId_idx" ON "VehiclePhotoCaptureConfig"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "VehiclePhotoCaptureConfig_branchId_categoryId_key" ON "VehiclePhotoCaptureConfig"("branchId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_remainingPaymentId_key" ON "Booking"("remainingPaymentId");

-- CreateIndex
CREATE INDEX "Booking_remainingPaymentId_idx" ON "Booking"("remainingPaymentId");

-- AddForeignKey
ALTER TABLE "VehiclePhotoCaptureConfig" ADD CONSTRAINT "VehiclePhotoCaptureConfig_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehiclePhotoCaptureConfig" ADD CONSTRAINT "VehiclePhotoCaptureConfig_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "VehicleCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorBranchId_fkey" FOREIGN KEY ("actorBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
