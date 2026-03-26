-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "chargeType" TEXT,
ADD COLUMN     "isTaxable" BOOLEAN NOT NULL DEFAULT true;
