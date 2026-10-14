-- Oct 15 2026: photos of the replacement car at a mid-rental vehicle swap
-- (client item 2). They are BookingPhoto rows of the new type SWAP_DELIVERY,
-- linked to the swap (swapId) and to the car they show (vehicleId), so the drop
-- screens can show the condition of the car actually coming back.
-- Plus the FASTag balances read at the swap (returning car's closing balance,
-- replacement's opening balance) for cars with a FASTag, and the branch that
-- uploaded a pickup / return / damage photo (FileObject.uploadedBranchId; null
-- for older files), so such a photo is only removed / attached from its branch.
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.

ALTER TYPE "BookingPhotoType" ADD VALUE IF NOT EXISTS 'SWAP_DELIVERY';

ALTER TABLE "BookingPhoto" ADD COLUMN IF NOT EXISTS "swapId" INTEGER;
ALTER TABLE "BookingPhoto" ADD COLUMN IF NOT EXISTS "vehicleId" INTEGER;
CREATE INDEX IF NOT EXISTS "BookingPhoto_swapId_idx" ON "BookingPhoto"("swapId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BookingPhoto_swapId_fkey') THEN
    ALTER TABLE "BookingPhoto" ADD CONSTRAINT "BookingPhoto_swapId_fkey"
      FOREIGN KEY ("swapId") REFERENCES "VehicleSwap"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BookingPhoto_vehicleId_fkey') THEN
    ALTER TABLE "BookingPhoto" ADD CONSTRAINT "BookingPhoto_vehicleId_fkey"
      FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "VehicleSwap" ADD COLUMN IF NOT EXISTS "oldVehicleFastagBalance" DECIMAL(10,2);
ALTER TABLE "VehicleSwap" ADD COLUMN IF NOT EXISTS "newVehicleFastagBalance" DECIMAL(10,2);

ALTER TABLE "FileObject" ADD COLUMN IF NOT EXISTS "uploadedBranchId" INTEGER;
