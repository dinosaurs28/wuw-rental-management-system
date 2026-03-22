-- AlterTable
ALTER TABLE "BranchDiscountConfig" ADD COLUMN     "managerCouponCreationEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxManagerCouponDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 15,
ADD COLUMN     "maxManagerCouponFlatAmount" DECIMAL(10,2) NOT NULL DEFAULT 500,
ADD COLUMN     "maxManagerCouponUsageLimit" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "maxManagerCouponValidityDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "maxManagerCouponsPerDay" INTEGER NOT NULL DEFAULT 3;
