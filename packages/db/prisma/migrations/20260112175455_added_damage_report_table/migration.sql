/*
  Warnings:

  - Added the required column `notes` to the `DamageReport` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "BookingPhoto" ADD COLUMN     "damageReportId" INTEGER;

-- AlterTable
ALTER TABLE "DamageReport" DROP COLUMN "notes",
ADD COLUMN     "notes" JSONB NOT NULL;

-- AddForeignKey
ALTER TABLE "BookingPhoto" ADD CONSTRAINT "BookingPhoto_damageReportId_fkey" FOREIGN KEY ("damageReportId") REFERENCES "DamageReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
