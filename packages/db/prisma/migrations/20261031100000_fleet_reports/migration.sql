-- Oct 31 2026: Admin Reports — fleet (4.1 utilization, 4.3 profitability, 5.1 damage,
-- 5.2 downtime, 6.1 document expiry).
--
--  1. Vehicle: optional RC / permit / PUC / fitness expiry dates (null = not recorded).
--  2. VehicleStatusHistory: every Vehicle.status change, written by a trigger so no
--     code path can skip it. Existing vehicles get ONE 'BASELINE' row holding their
--     status at deploy time; status history before that is unknown (reports say so).
--  3. VehicleExpense: costs an admin records against a vehicle (maintenance / repair /
--     other), optionally linked to the DamageReport it repaired.
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.
-- Timestamps are stored as UTC, like Prisma's DateTime columns.

ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "rcExpiry"      TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "permitExpiry"  TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "pucExpiry"     TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "fitnessExpiry" TIMESTAMP(3);

-- ── Status history ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "VehicleStatusHistory" (
  "id"         SERIAL PRIMARY KEY,
  "vehicleId"  INTEGER NOT NULL,
  "fromStatus" "VehicleStatus",
  "toStatus"   "VehicleStatus" NOT NULL,
  "changedAt"  TIMESTAMP(3) NOT NULL DEFAULT timezone('UTC', now()),
  "source"     TEXT NOT NULL DEFAULT 'UPDATE'
);
CREATE INDEX IF NOT EXISTS "VehicleStatusHistory_vehicleId_changedAt_idx" ON "VehicleStatusHistory"("vehicleId", "changedAt");
CREATE INDEX IF NOT EXISTS "VehicleStatusHistory_changedAt_idx" ON "VehicleStatusHistory"("changedAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VehicleStatusHistory_vehicleId_fkey') THEN
    ALTER TABLE "VehicleStatusHistory" ADD CONSTRAINT "VehicleStatusHistory_vehicleId_fkey"
      FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION "vehicle_status_history_log"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "VehicleStatusHistory" ("vehicleId", "fromStatus", "toStatus", "changedAt", "source")
    VALUES (NEW."id", NULL, NEW."status", timezone('UTC', now()), 'INSERT');
  ELSIF NEW."status" IS DISTINCT FROM OLD."status" THEN
    INSERT INTO "VehicleStatusHistory" ("vehicleId", "fromStatus", "toStatus", "changedAt", "source")
    VALUES (NEW."id", OLD."status", NEW."status", timezone('UTC', now()), 'UPDATE');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'Vehicle_status_history_trg') THEN
    CREATE TRIGGER "Vehicle_status_history_trg"
      AFTER INSERT OR UPDATE OF "status" ON "Vehicle"
      FOR EACH ROW EXECUTE FUNCTION "vehicle_status_history_log"();
  END IF;
END $$;

-- Baseline: one row per vehicle that has no history yet (first run only)
INSERT INTO "VehicleStatusHistory" ("vehicleId", "fromStatus", "toStatus", "changedAt", "source")
SELECT v."id", NULL, v."status", timezone('UTC', now()), 'BASELINE'
FROM "Vehicle" v
WHERE NOT EXISTS (SELECT 1 FROM "VehicleStatusHistory" h WHERE h."vehicleId" = v."id");

-- ── Vehicle expenses ───────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VehicleExpenseCategory') THEN
    CREATE TYPE "VehicleExpenseCategory" AS ENUM ('MAINTENANCE', 'REPAIR', 'OTHER');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "VehicleExpense" (
  "id"             SERIAL PRIMARY KEY,
  "publicId"       TEXT NOT NULL,
  "vehicleId"      INTEGER NOT NULL,
  "category"       "VehicleExpenseCategory" NOT NULL,
  "amount"         DECIMAL(12,2) NOT NULL,
  "incurredAt"     TIMESTAMP(3) NOT NULL,
  "note"           TEXT,
  "damageReportId" INTEGER,
  "createdById"    INTEGER,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "deletedAt"      TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "VehicleExpense_publicId_key" ON "VehicleExpense"("publicId");
CREATE INDEX IF NOT EXISTS "VehicleExpense_vehicleId_incurredAt_idx" ON "VehicleExpense"("vehicleId", "incurredAt");
CREATE INDEX IF NOT EXISTS "VehicleExpense_incurredAt_idx" ON "VehicleExpense"("incurredAt");
CREATE INDEX IF NOT EXISTS "VehicleExpense_damageReportId_idx" ON "VehicleExpense"("damageReportId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VehicleExpense_vehicleId_fkey') THEN
    ALTER TABLE "VehicleExpense" ADD CONSTRAINT "VehicleExpense_vehicleId_fkey"
      FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VehicleExpense_damageReportId_fkey') THEN
    ALTER TABLE "VehicleExpense" ADD CONSTRAINT "VehicleExpense_damageReportId_fkey"
      FOREIGN KEY ("damageReportId") REFERENCES "DamageReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VehicleExpense_createdById_fkey') THEN
    ALTER TABLE "VehicleExpense" ADD CONSTRAINT "VehicleExpense_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
