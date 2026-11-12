-- Nov 12 2026 (client TODO 10): the rental runs from the actual handover.
-- Columns only; existing bookings keep NULLs (handed over before this rule).
-- Re-runnable (IF NOT EXISTS).
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "pickedUpAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "scheduledStartAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "scheduledEndAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "pickupDelayMinutes" INTEGER;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "pickupShiftCapReason" TEXT;

-- Nov 12 2026 (client TODO 4): the last drop / return time is 10:30 PM. Returns
-- now end at closing − 30 min + the branch's return grace (Branch.graceMinutes),
-- so a branch with grace > 0 would still offer 10:45 / 11:00 / 11:30 PM. Reset the
-- grace to 0 ONCE. A marker in the Branch table comment records that it ran, so a
-- manager who later sets a grace on purpose keeps it on later deploys.
DO $$
DECLARE
  marker CONSTANT text := 'return_cutoff_1030pm applied';
  current_comment text := obj_description('"Branch"'::regclass, 'pg_class');
BEGIN
  IF current_comment IS NULL OR position(marker IN current_comment) = 0 THEN
    UPDATE "Branch" SET "graceMinutes" = 0 WHERE "graceMinutes" > 0;
    EXECUTE format(
      'COMMENT ON TABLE "Branch" IS %L',
      CASE WHEN current_comment IS NULL OR current_comment = '' THEN marker
           ELSE current_comment || '; ' || marker END
    );
  END IF;
END $$;
