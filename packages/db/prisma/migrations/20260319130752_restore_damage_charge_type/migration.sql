-- CreateEnum
CREATE TYPE "DamageChargeType" AS ENUM ('PENALTY', 'COMPENSATION');

-- AlterTable
ALTER TABLE "DamageReport" ADD COLUMN     "chargeType" "DamageChargeType" NOT NULL DEFAULT 'PENALTY';
