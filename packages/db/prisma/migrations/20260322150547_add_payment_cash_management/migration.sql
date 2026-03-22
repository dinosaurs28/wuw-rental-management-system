-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'ONLINE', 'SPLIT');

-- CreateEnum
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('INITIATED', 'COLLECTED', 'CONFIRMED', 'FAILED', 'REJECTED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('ADVANCE', 'REMAINING_BALANCE', 'FULL_PAYMENT', 'EXTENSION', 'DAMAGE_FEE', 'SAFETY_DEPOSIT', 'OVERPAYMENT_REFUND', 'CANCELLATION_REFUND');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CashShiftStatus" AS ENUM ('OPEN', 'CLOSED', 'DISCREPANCY_FLAGGED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StaffActionType" ADD VALUE 'COLLECTED';
ALTER TYPE "StaffActionType" ADD VALUE 'RECONCILED';
ALTER TYPE "StaffActionType" ADD VALUE 'SETTLED';
ALTER TYPE "StaffActionType" ADD VALUE 'DISBURSED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StaffEntityType" ADD VALUE 'PAYMENT_TRANSACTION';
ALTER TYPE "StaffEntityType" ADD VALUE 'CASH_SHIFT';
ALTER TYPE "StaffEntityType" ADD VALUE 'REFUND_REQUEST';

-- CreateTable
CREATE TABLE "BranchPaymentConfig" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "cashConfirmationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "blockProgressionUntilConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "maxCashPerEmployee" DECIMAL(10,2),
    "requireShiftSettlement" BOOLEAN NOT NULL DEFAULT false,
    "splitPaymentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "crossBranchSettlementEnabled" BOOLEAN NOT NULL DEFAULT false,
    "refundApprovalRequired" BOOLEAN NOT NULL DEFAULT true,
    "onlineRefundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "delayedCashAlertHours" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchPaymentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'INITIATED',
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "cashAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "onlineAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "onlineTransactionRef" TEXT,
    "onlineGateway" TEXT,
    "collectedById" INTEGER,
    "collectedAt" TIMESTAMP(3),
    "confirmedById" INTEGER,
    "confirmedAt" TIMESTAMP(3),
    "rejectedById" INTEGER,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "cashShiftId" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundRequest" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requestedById" INTEGER NOT NULL,
    "approvedById" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "completedById" INTEGER,
    "completedAt" TIMESTAMP(3),
    "onlineTransactionRef" TEXT,
    "rejectionReason" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashShift" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "status" "CashShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "expectedTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "actualTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discrepancy" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discrepancyExplanation" TEXT,
    "reconciledById" INTEGER,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BranchPaymentConfig_branchId_key" ON "BranchPaymentConfig"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_publicId_key" ON "PaymentTransaction"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_idempotencyKey_key" ON "PaymentTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentTransaction_bookingId_idx" ON "PaymentTransaction"("bookingId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_branchId_status_idx" ON "PaymentTransaction"("branchId", "status");

-- CreateIndex
CREATE INDEX "PaymentTransaction_collectedById_collectedAt_idx" ON "PaymentTransaction"("collectedById", "collectedAt");

-- CreateIndex
CREATE INDEX "PaymentTransaction_cashShiftId_idx" ON "PaymentTransaction"("cashShiftId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_purpose_idx" ON "PaymentTransaction"("purpose");

-- CreateIndex
CREATE INDEX "PaymentTransaction_status_createdAt_idx" ON "PaymentTransaction"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefundRequest_publicId_key" ON "RefundRequest"("publicId");

-- CreateIndex
CREATE INDEX "RefundRequest_bookingId_idx" ON "RefundRequest"("bookingId");

-- CreateIndex
CREATE INDEX "RefundRequest_branchId_status_idx" ON "RefundRequest"("branchId", "status");

-- CreateIndex
CREATE INDEX "RefundRequest_requestedById_idx" ON "RefundRequest"("requestedById");

-- CreateIndex
CREATE UNIQUE INDEX "CashShift_publicId_key" ON "CashShift"("publicId");

-- CreateIndex
CREATE INDEX "CashShift_employeeId_status_idx" ON "CashShift"("employeeId", "status");

-- CreateIndex
CREATE INDEX "CashShift_branchId_status_idx" ON "CashShift"("branchId", "status");

-- CreateIndex
CREATE INDEX "CashShift_openedAt_idx" ON "CashShift"("openedAt");

-- AddForeignKey
ALTER TABLE "BranchPaymentConfig" ADD CONSTRAINT "BranchPaymentConfig_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_reconciledById_fkey" FOREIGN KEY ("reconciledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
