-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "kycFileId" INTEGER;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_kycFileId_fkey" FOREIGN KEY ("kycFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
