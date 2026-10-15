-- Oct 17 2026: the branch manager cancels an upcoming or active rent by hand from
-- the Fleet tab. The booking keeps its row (status CANCELLED) and now records who
-- cancelled it and how; older cancellations and the other paths leave them null.
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BookingCancellationSource') THEN
    CREATE TYPE "BookingCancellationSource" AS ENUM ('MANUAL_BM');
  END IF;
END $$;

ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "cancelledById" INTEGER;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "cancellationSource" "BookingCancellationSource";
