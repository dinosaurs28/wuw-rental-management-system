-- Nov 14 2026 (client: "Vehicle transfer from one branch to another"): one row per
-- transfer of a vehicle between branches (admin, or the branch manager of the
-- vehicle's branch). Vehicle.branchId is changed in the same transaction.
-- Branch / user names are snapshotted so the history still reads after a branch
-- or user is hard-deleted (their ids go NULL). Re-runnable (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS "VehicleBranchTransfer" (
  "id"                  SERIAL PRIMARY KEY,
  "publicId"            TEXT NOT NULL,
  "vehicleId"           INTEGER NOT NULL,
  "fromBranchId"        INTEGER,
  "toBranchId"          INTEGER,
  "fromBranchName"      TEXT NOT NULL,
  "toBranchName"        TEXT NOT NULL,
  "transferredByUserId" INTEGER,
  "transferredByName"   TEXT,
  "transferredByRole"   TEXT,
  "reason"              TEXT NOT NULL,
  "odometer"            INTEGER,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "VehicleBranchTransfer_publicId_key" ON "VehicleBranchTransfer"("publicId");
CREATE INDEX IF NOT EXISTS "VehicleBranchTransfer_vehicleId_createdAt_idx" ON "VehicleBranchTransfer"("vehicleId", "createdAt");
CREATE INDEX IF NOT EXISTS "VehicleBranchTransfer_fromBranchId_idx" ON "VehicleBranchTransfer"("fromBranchId");
CREATE INDEX IF NOT EXISTS "VehicleBranchTransfer_toBranchId_idx" ON "VehicleBranchTransfer"("toBranchId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VehicleBranchTransfer_vehicleId_fkey') THEN
    ALTER TABLE "VehicleBranchTransfer" ADD CONSTRAINT "VehicleBranchTransfer_vehicleId_fkey"
      FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VehicleBranchTransfer_fromBranchId_fkey') THEN
    ALTER TABLE "VehicleBranchTransfer" ADD CONSTRAINT "VehicleBranchTransfer_fromBranchId_fkey"
      FOREIGN KEY ("fromBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VehicleBranchTransfer_toBranchId_fkey') THEN
    ALTER TABLE "VehicleBranchTransfer" ADD CONSTRAINT "VehicleBranchTransfer_toBranchId_fkey"
      FOREIGN KEY ("toBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VehicleBranchTransfer_transferredByUserId_fkey') THEN
    ALTER TABLE "VehicleBranchTransfer" ADD CONSTRAINT "VehicleBranchTransfer_transferredByUserId_fkey"
      FOREIGN KEY ("transferredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
