-- CreateEnum
CREATE TYPE "PaymentSessionStatus" AS ENUM ('OPEN', 'COMPUTING', 'AWAITING_PAYMENT', 'PAYMENT_INITIATED', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "PaymentSessionType" AS ENUM ('BOOKING', 'PICKUP', 'EXTENSION', 'RETURN');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('BOOKING_BASE', 'EXTENSION', 'DEPOSIT', 'EXTRA_KM', 'EXTRA_TIME', 'FUEL', 'FASTAG', 'DAMAGE', 'GRACE_ADJUSTMENT', 'DISCOUNT', 'PAYMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "LedgerEntryClassification" AS ENUM ('TAXABLE', 'NON_TAXABLE', 'DISCOUNT', 'PAYMENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StaffEntityType" ADD VALUE 'PAYMENT_SESSION';
ALTER TYPE "StaffEntityType" ADD VALUE 'LEDGER_ENTRY';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "activePaymentSessionId" INTEGER;

-- AlterTable
ALTER TABLE "BranchChargeConfig" ADD COLUMN     "usePaymentSessions" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PaymentSession" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "sessionType" "PaymentSessionType" NOT NULL,
    "status" "PaymentSessionStatus" NOT NULL DEFAULT 'OPEN',
    "taxableBase" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "nonTaxableBase" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "gstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalCharges" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalDiscounts" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalPaymentsRecorded" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netPayable" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "gatewayTransactionId" TEXT,
    "gatewayPaymentUrl" TEXT,
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "actorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "entryType" "LedgerEntryType" NOT NULL,
    "classification" "LedgerEntryClassification" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "baseAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "gstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "isVoided" BOOLEAN NOT NULL DEFAULT false,
    "voidedAt" TIMESTAMP(3),
    "voidedById" INTEGER,
    "voidReason" TEXT,
    "actorId" INTEGER NOT NULL,
    "actorRole" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSession_publicId_key" ON "PaymentSession"("publicId");

-- CreateIndex
CREATE INDEX "PaymentSession_bookingId_idx" ON "PaymentSession"("bookingId");

-- CreateIndex
CREATE INDEX "PaymentSession_branchId_idx" ON "PaymentSession"("branchId");

-- CreateIndex
CREATE INDEX "PaymentSession_status_idx" ON "PaymentSession"("status");

-- CreateIndex
CREATE INDEX "PaymentSession_sessionType_status_idx" ON "PaymentSession"("sessionType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_publicId_key" ON "LedgerEntry"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_sessionId_idx" ON "LedgerEntry"("sessionId");

-- CreateIndex
CREATE INDEX "LedgerEntry_bookingId_idx" ON "LedgerEntry"("bookingId");

-- CreateIndex
CREATE INDEX "LedgerEntry_entryType_idx" ON "LedgerEntry"("entryType");

-- CreateIndex
CREATE INDEX "LedgerEntry_isVoided_idx" ON "LedgerEntry"("isVoided");

-- CreateIndex
CREATE INDEX "Booking_activePaymentSessionId_idx" ON "Booking"("activePaymentSessionId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_activePaymentSessionId_fkey" FOREIGN KEY ("activePaymentSessionId") REFERENCES "PaymentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSession" ADD CONSTRAINT "PaymentSession_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSession" ADD CONSTRAINT "PaymentSession_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSession" ADD CONSTRAINT "PaymentSession_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PaymentSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
