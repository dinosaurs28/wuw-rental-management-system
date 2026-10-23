-- Oct 28 2026: the branch manager closes cash shifts (Financials → Cash Shift).
-- Fleet Executives open their own shift and collect; they no longer close it.
--   * CashShift.closedById — who closed the shift (the manager). Shifts closed
--     before this release were closed by the executive themselves (null here);
--     reconciledById keeps its old meaning for those (a manager's reconcile).
--   * One OPEN shift per executive, guaranteed by a partial unique index. If
--     existing data already has an executive with two OPEN shifts the index is
--     skipped with a NOTICE (the API check still refuses a second one) and is
--     created on the next deploy once the duplicate is closed.
--   * NotificationType SHIFT_CLOSED — the executive's "your shift was closed".
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.
-- The new enum value is not used in this file.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'NotificationType' AND e.enumlabel = 'SHIFT_CLOSED'
  ) THEN
    ALTER TYPE "NotificationType" ADD VALUE 'SHIFT_CLOSED';
  END IF;
END $$;

ALTER TABLE "CashShift" ADD COLUMN IF NOT EXISTS "closedById" INTEGER;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CashShift_closedById_fkey') THEN
    ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_closedById_fkey"
      FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "CashShift_closedAt_idx" ON "CashShift"("closedAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'CashShift_one_open_per_employee') THEN
    IF EXISTS (
      SELECT 1 FROM "CashShift" WHERE "status" = 'OPEN'
      GROUP BY "employeeId" HAVING COUNT(*) > 1
    ) THEN
      RAISE NOTICE 'CashShift_one_open_per_employee skipped: an employee has more than one OPEN shift';
    ELSE
      CREATE UNIQUE INDEX "CashShift_one_open_per_employee" ON "CashShift"("employeeId") WHERE "status" = 'OPEN';
    END IF;
  END IF;
END $$;
