-- Oct 21 2026: km of the returning car recorded at a mid-rental vehicle swap
-- (client request). When a picked-up booking moves to another car, the swap
-- stores what the drop will bill for the car handed back: the km driven on it
-- this segment, the free km left for that segment, the extra km and the extra-km
-- charge at the rate the drop bills with — worked out by the drop's own rule
-- (the booking's free km pooled across the cars, used in order) — plus the
-- booking's total free km at the swap. The drop shows it under "Vehicle swap";
-- the drop bill still bills km once, for the whole rental.
-- Rows from before this (and swaps without readings) keep NULLs.
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.

ALTER TABLE "VehicleSwap" ADD COLUMN IF NOT EXISTS "segmentKmDriven" INTEGER;
ALTER TABLE "VehicleSwap" ADD COLUMN IF NOT EXISTS "segmentIncludedKm" INTEGER;
ALTER TABLE "VehicleSwap" ADD COLUMN IF NOT EXISTS "segmentAllowanceKm" INTEGER;
ALTER TABLE "VehicleSwap" ADD COLUMN IF NOT EXISTS "segmentExtraKm" INTEGER;
ALTER TABLE "VehicleSwap" ADD COLUMN IF NOT EXISTS "segmentExtraKmRate" DECIMAL(10,2);
ALTER TABLE "VehicleSwap" ADD COLUMN IF NOT EXISTS "segmentExtraKmCharge" DECIMAL(10,2);
ALTER TABLE "VehicleSwap" ADD COLUMN IF NOT EXISTS "segmentExtraKmEnabled" BOOLEAN;
