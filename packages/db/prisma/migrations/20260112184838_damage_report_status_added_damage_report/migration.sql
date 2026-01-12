-- CreateEnum
CREATE TYPE "DamageReportStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "DamageReport" ADD COLUMN     "status" "DamageReportStatus" NOT NULL DEFAULT 'PENDING';
