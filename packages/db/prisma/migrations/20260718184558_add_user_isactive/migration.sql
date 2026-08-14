-- AlterEnum
ALTER TYPE "StaffActionType" ADD VALUE 'ACTIVATED';
ALTER TYPE "StaffActionType" ADD VALUE 'DEACTIVATED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");
