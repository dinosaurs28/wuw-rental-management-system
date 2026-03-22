-- CreateEnum
CREATE TYPE "DiscountScope" AS ENUM ('GLOBAL', 'BRANCH', 'USER');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FLAT');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('NONE', 'PENDING_REFUND', 'REFUNDED', 'WALLET_CREDITED', 'CASH_HANDLED');

-- CreateEnum
CREATE TYPE "ManualDiscountStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "AuditCategory" ADD VALUE 'DISCOUNT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StaffActionType" ADD VALUE 'APPLIED';
ALTER TYPE "StaffActionType" ADD VALUE 'OVERRIDDEN';
ALTER TYPE "StaffActionType" ADD VALUE 'RECALCULATED';
ALTER TYPE "StaffActionType" ADD VALUE 'FLAGGED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StaffEntityType" ADD VALUE 'DISCOUNT_RULE';
ALTER TYPE "StaffEntityType" ADD VALUE 'DISCOUNT_APPLICATION';
ALTER TYPE "StaffEntityType" ADD VALUE 'MANUAL_DISCOUNT';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "discountRuleId" INTEGER;

-- CreateTable
CREATE TABLE "DiscountRule" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "discountType" "DiscountType" NOT NULL,
    "value" DECIMAL(10,4) NOT NULL,
    "maxDiscountCap" DECIMAL(10,2),
    "scope" "DiscountScope" NOT NULL DEFAULT 'GLOBAL',
    "applicableBranchIds" INTEGER[],
    "targetCustomerIds" INTEGER[],
    "newCustomersOnly" BOOLEAN NOT NULL DEFAULT false,
    "minBookingCount" INTEGER,
    "maxBookingCount" INTEGER,
    "minBookingAmount" DECIMAL(10,2),
    "maxBookingAmount" DECIMAL(10,2),
    "applicableVehicleCategoryIds" INTEGER[],
    "minRentalDays" INTEGER,
    "maxRentalDays" INTEGER,
    "applicablePaymentPlans" TEXT[],
    "allowPartialPayment" BOOLEAN NOT NULL DEFAULT true,
    "minAdvanceAfterDiscount" DECIMAL(10,2),
    "allowPostBooking" BOOLEAN NOT NULL DEFAULT false,
    "allowPostInvoice" BOOLEAN NOT NULL DEFAULT false,
    "totalUsageLimit" INTEGER,
    "perUserLimit" INTEGER,
    "perBranchLimit" INTEGER,
    "perDayLimit" INTEGER,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscountRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DurationDiscountSlab" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "minDays" INTEGER NOT NULL,
    "maxDays" INTEGER,
    "discountType" "DiscountType" NOT NULL,
    "value" DECIMAL(10,4) NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DurationDiscountSlab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchDiscountConfig" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "durationDiscountEnabled" BOOLEAN NOT NULL DEFAULT false,
    "stackWithCoupon" BOOLEAN NOT NULL DEFAULT false,
    "maxCombinedDiscountPercent" DECIMAL(5,2),
    "managerApprovalThreshold" DECIMAL(10,2) NOT NULL DEFAULT 500,
    "maxManualDiscountsPerEmployeePerDay" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchDiscountConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountApplication" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "originalAmount" DECIMAL(10,2) NOT NULL,
    "durationDiscountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "durationDiscountPercent" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "durationSlabId" INTEGER,
    "couponDiscountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "couponDiscountPercent" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "discountRuleId" INTEGER,
    "manualDiscountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "manualDiscountId" INTEGER,
    "totalDiscountAmount" DECIMAL(10,2) NOT NULL,
    "finalAmount" DECIMAL(10,2) NOT NULL,
    "paymentPlan" TEXT NOT NULL,
    "adjustmentType" "AdjustmentType" NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponUsageLog" (
    "id" SERIAL NOT NULL,
    "discountRuleId" INTEGER NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "discountedAmount" DECIMAL(10,2) NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualDiscount" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "issuedById" INTEGER NOT NULL,
    "approvedById" INTEGER,
    "status" "ManualDiscountStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscountRule_publicId_key" ON "DiscountRule"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountRule_code_key" ON "DiscountRule"("code");

-- CreateIndex
CREATE INDEX "DiscountRule_code_idx" ON "DiscountRule"("code");

-- CreateIndex
CREATE INDEX "DiscountRule_isActive_startDate_endDate_idx" ON "DiscountRule"("isActive", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "DiscountRule_scope_idx" ON "DiscountRule"("scope");

-- CreateIndex
CREATE INDEX "DiscountRule_createdById_idx" ON "DiscountRule"("createdById");

-- CreateIndex
CREATE INDEX "DurationDiscountSlab_branchId_minDays_idx" ON "DurationDiscountSlab"("branchId", "minDays");

-- CreateIndex
CREATE UNIQUE INDEX "BranchDiscountConfig_branchId_key" ON "BranchDiscountConfig"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountApplication_publicId_key" ON "DiscountApplication"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountApplication_bookingId_key" ON "DiscountApplication"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountApplication_manualDiscountId_key" ON "DiscountApplication"("manualDiscountId");

-- CreateIndex
CREATE INDEX "DiscountApplication_bookingId_idx" ON "DiscountApplication"("bookingId");

-- CreateIndex
CREATE INDEX "DiscountApplication_discountRuleId_idx" ON "DiscountApplication"("discountRuleId");

-- CreateIndex
CREATE INDEX "CouponUsageLog_discountRuleId_customerId_idx" ON "CouponUsageLog"("discountRuleId", "customerId");

-- CreateIndex
CREATE INDEX "CouponUsageLog_discountRuleId_branchId_appliedAt_idx" ON "CouponUsageLog"("discountRuleId", "branchId", "appliedAt");

-- CreateIndex
CREATE INDEX "CouponUsageLog_customerId_appliedAt_idx" ON "CouponUsageLog"("customerId", "appliedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ManualDiscount_publicId_key" ON "ManualDiscount"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "ManualDiscount_bookingId_key" ON "ManualDiscount"("bookingId");

-- CreateIndex
CREATE INDEX "ManualDiscount_issuedById_createdAt_idx" ON "ManualDiscount"("issuedById", "createdAt");

-- CreateIndex
CREATE INDEX "ManualDiscount_bookingId_idx" ON "ManualDiscount"("bookingId");

-- CreateIndex
CREATE INDEX "ManualDiscount_status_idx" ON "ManualDiscount"("status");

-- CreateIndex
CREATE INDEX "Booking_discountRuleId_idx" ON "Booking"("discountRuleId");

-- CreateIndex
CREATE INDEX "Booking_couponCode_idx" ON "Booking"("couponCode");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_discountRuleId_fkey" FOREIGN KEY ("discountRuleId") REFERENCES "DiscountRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountRule" ADD CONSTRAINT "DiscountRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DurationDiscountSlab" ADD CONSTRAINT "DurationDiscountSlab_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchDiscountConfig" ADD CONSTRAINT "BranchDiscountConfig_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountApplication" ADD CONSTRAINT "DiscountApplication_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountApplication" ADD CONSTRAINT "DiscountApplication_discountRuleId_fkey" FOREIGN KEY ("discountRuleId") REFERENCES "DiscountRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountApplication" ADD CONSTRAINT "DiscountApplication_manualDiscountId_fkey" FOREIGN KEY ("manualDiscountId") REFERENCES "ManualDiscount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponUsageLog" ADD CONSTRAINT "CouponUsageLog_discountRuleId_fkey" FOREIGN KEY ("discountRuleId") REFERENCES "DiscountRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualDiscount" ADD CONSTRAINT "ManualDiscount_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualDiscount" ADD CONSTRAINT "ManualDiscount_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualDiscount" ADD CONSTRAINT "ManualDiscount_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
