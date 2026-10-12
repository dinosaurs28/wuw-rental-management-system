-- Oct 12 2026: weekend-wise rental pricing. Optional weekend 12 h / 24 h rents
-- (GST-inclusive totals + derived "without GST" parts, null = the weekday rent)
-- on vehicle custom pricing and branch pricing defaults, and the branch's
-- weekend days (ISO weekday 1 = Mon … 7 = Sun, default Saturday + Sunday).
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.

ALTER TABLE "VehicleCustomPricing" ADD COLUMN IF NOT EXISTS "weekendTotalRent12Hour" DECIMAL(10,2);
ALTER TABLE "VehicleCustomPricing" ADD COLUMN IF NOT EXISTS "weekendTotalRent24Hour" DECIMAL(10,2);
ALTER TABLE "VehicleCustomPricing" ADD COLUMN IF NOT EXISTS "weekendRentWithoutGst12Hour" DECIMAL(10,2);
ALTER TABLE "VehicleCustomPricing" ADD COLUMN IF NOT EXISTS "weekendRentWithoutGst24Hour" DECIMAL(10,2);

ALTER TABLE "BranchPricingDefaults" ADD COLUMN IF NOT EXISTS "weekendTotalRent12Hour" DECIMAL(10,2);
ALTER TABLE "BranchPricingDefaults" ADD COLUMN IF NOT EXISTS "weekendTotalRent24Hour" DECIMAL(10,2);
ALTER TABLE "BranchPricingDefaults" ADD COLUMN IF NOT EXISTS "weekendRentWithoutGst12Hour" DECIMAL(10,2);
ALTER TABLE "BranchPricingDefaults" ADD COLUMN IF NOT EXISTS "weekendRentWithoutGst24Hour" DECIMAL(10,2);

ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "weekendDays" INTEGER[] NOT NULL DEFAULT ARRAY[6, 7]::INTEGER[];
