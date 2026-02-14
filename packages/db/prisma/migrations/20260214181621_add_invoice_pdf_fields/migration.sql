/*
  Warnings:

  - A unique constraint covering the columns `[invoiceNumber]` on the table `Invoice` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'HOLD_EXPIRED';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "generatedAt" TIMESTAMP(3),
ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "invoicePdfFileId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_invoicePdfFileId_idx" ON "Invoice"("invoicePdfFileId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_invoicePdfFileId_fkey" FOREIGN KEY ("invoicePdfFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
