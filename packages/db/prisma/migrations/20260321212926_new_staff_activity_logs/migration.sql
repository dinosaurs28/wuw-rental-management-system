/*
  Warnings:

  - You are about to drop the column `action` on the `StaffActivityLog` table. All the data in the column will be lost.
  - You are about to drop the column `entity` on the `StaffActivityLog` table. All the data in the column will be lost.
  - You are about to drop the column `entityId` on the `StaffActivityLog` table. All the data in the column will be lost.
  - You are about to drop the column `staffId` on the `StaffActivityLog` table. All the data in the column will be lost.
  - Added the required column `actionType` to the `StaffActivityLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `actorName` to the `StaffActivityLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `actorPublicId` to the `StaffActivityLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `actorRole` to the `StaffActivityLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `branchId` to the `StaffActivityLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `branchName` to the `StaffActivityLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `description` to the `StaffActivityLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `entityRef` to the `StaffActivityLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `entityType` to the `StaffActivityLog` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "StaffActionType" AS ENUM ('CREATED', 'APPROVED', 'REJECTED', 'CANCELLED', 'CONFIRMED', 'UPDATED', 'DELETED', 'UPLOADED', 'SWAPPED', 'REFUNDED', 'ASSESSED', 'INITIATED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "StaffEntityType" AS ENUM ('BOOKING', 'INVOICE', 'PAYMENT', 'CUSTOMER', 'VEHICLE', 'KYC', 'DAMAGE_REPORT', 'DEPOSIT', 'EMPLOYEE', 'PRICING', 'CAPTURE_CONFIG');

-- AlterTable
ALTER TABLE "StaffActivityLog" DROP COLUMN "action",
DROP COLUMN "entity",
DROP COLUMN "entityId",
DROP COLUMN "staffId",
ADD COLUMN     "actionType" "StaffActionType" NOT NULL,
ADD COLUMN     "actorName" TEXT NOT NULL,
ADD COLUMN     "actorPublicId" TEXT NOT NULL,
ADD COLUMN     "actorRole" "Role" NOT NULL,
ADD COLUMN     "branchId" INTEGER NOT NULL,
ADD COLUMN     "branchName" TEXT NOT NULL,
ADD COLUMN     "description" TEXT NOT NULL,
ADD COLUMN     "entityRef" TEXT NOT NULL,
ADD COLUMN     "entityType" "StaffEntityType" NOT NULL,
ADD COLUMN     "metadata" JSONB;

-- CreateIndex
CREATE INDEX "StaffActivityLog_branchId_idx" ON "StaffActivityLog"("branchId");

-- CreateIndex
CREATE INDEX "StaffActivityLog_actorPublicId_idx" ON "StaffActivityLog"("actorPublicId");

-- CreateIndex
CREATE INDEX "StaffActivityLog_actionType_idx" ON "StaffActivityLog"("actionType");

-- CreateIndex
CREATE INDEX "StaffActivityLog_entityType_idx" ON "StaffActivityLog"("entityType");

-- CreateIndex
CREATE INDEX "StaffActivityLog_createdAt_idx" ON "StaffActivityLog"("createdAt");

-- AddForeignKey
ALTER TABLE "StaffActivityLog" ADD CONSTRAINT "StaffActivityLog_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
