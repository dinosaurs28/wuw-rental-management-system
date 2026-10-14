-- Oct 15 2026: FASTag balance at pickup and at the drop (client item). For cars
-- with a FASTag, staff read the tag's balance at the handover and again when
-- the car comes back; the usage between them (summed across mid-rental swaps,
-- VehicleSwap.oldVehicleFastagBalance / newVehicleFastagBalance) is billed on
-- the drop bill as the FASTag line, with no GST. Null = not read (older
-- bookings and app builds keep the manual FASTag charge).
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.

ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "pickupFastagBalance" DECIMAL(10,2);
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "returnFastagBalance" DECIMAL(10,2);
