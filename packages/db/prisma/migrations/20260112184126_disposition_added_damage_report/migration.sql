/*
  Warnings:

  - Added the required column `disposition` to the `DamageReport` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "VehicleReturnDisposition" AS ENUM ('AVAILABLE', 'MAINTENANCE', 'DAMAGED');

-- AlterTable
ALTER TABLE "DamageReport" ADD COLUMN     "disposition" "VehicleReturnDisposition" NOT NULL;
