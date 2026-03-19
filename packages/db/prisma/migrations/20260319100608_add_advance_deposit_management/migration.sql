/*
  Warnings:

  - You are about to drop the column `baseDailyPrice` on the `Vehicle` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "advanceAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "advancePaidAt" TIMESTAMP(3),
ADD COLUMN     "advancePaymentId" TEXT,
ADD COLUMN     "advancePaymentMode" "DepositMethod",
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "safetyDeposit" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "safetyDepositMethod" "DepositMethod",
ADD COLUMN     "safetyDepositPaidAt" TIMESTAMP(3),
ADD COLUMN     "safetyDepositRefunded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "safetyDepositRefundedAt" TIMESTAMP(3),
ADD COLUMN     "safetyDepositSetOff" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Vehicle" DROP COLUMN "baseDailyPrice";

-- CreateTable
CREATE TABLE "CancellationInvoice" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "advanceAmount" DECIMAL(65,30) NOT NULL,
    "cancellationFee" DECIMAL(65,30) NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "invoiceNumber" TEXT,
    "invoicePdfFileId" INTEGER,
    "generatedAt" TIMESTAMP(3),
    "sentToCustomer" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CancellationInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CancellationInvoice_publicId_key" ON "CancellationInvoice"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationInvoice_bookingId_key" ON "CancellationInvoice"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationInvoice_invoiceNumber_key" ON "CancellationInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "CancellationInvoice_bookingId_idx" ON "CancellationInvoice"("bookingId");

-- CreateIndex
CREATE INDEX "CancellationInvoice_customerId_idx" ON "CancellationInvoice"("customerId");

-- CreateIndex
CREATE INDEX "CancellationInvoice_invoiceNumber_idx" ON "CancellationInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Booking_advancePaymentId_idx" ON "Booking"("advancePaymentId");

-- CreateIndex
CREATE INDEX "Booking_cancelledAt_idx" ON "Booking"("cancelledAt");

-- AddForeignKey
ALTER TABLE "CancellationInvoice" ADD CONSTRAINT "CancellationInvoice_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationInvoice" ADD CONSTRAINT "CancellationInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationInvoice" ADD CONSTRAINT "CancellationInvoice_invoicePdfFileId_fkey" FOREIGN KEY ("invoicePdfFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
