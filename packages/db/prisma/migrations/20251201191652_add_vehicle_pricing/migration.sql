/*
  Warnings:

  - Added the required column `baseDailyPrice` to the `Vehicle` table without a default value. This is not possible if the table is not empty.
  - Added the required column `baseHalfDayPrice` to the `Vehicle` table without a default value. This is not possible if the table is not empty.
  - Added the required column `baseHourlyPrice` to the `Vehicle` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "baseDailyPrice" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "baseHalfDayPrice" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "baseHourlyPrice" DECIMAL(65,30) NOT NULL;
