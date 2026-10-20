-- Oct 24 2026: booking locks (client: "create a booking lock for a Window"). A
-- branch manager (or admin) keeps cars from being booked for a date-time window
-- [startAt, endAt): the whole branch (BRANCH), some vehicles (vehicleIds) or
-- some vehicle groups (groupKeys, MAKE__MODEL__categoryId). customersOnly hides
-- the cars from customers only (staff walk-ins still allowed). Existing bookings
-- are never changed. Soft-cancelled (cancelledAt / cancelledById).
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BookingLockScope') THEN
    CREATE TYPE "BookingLockScope" AS ENUM ('BRANCH', 'VEHICLES', 'GROUPS');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "BookingLock" (
  "id"            SERIAL PRIMARY KEY,
  "publicId"      TEXT NOT NULL,
  "branchId"      INTEGER NOT NULL,
  "startAt"       TIMESTAMP(3) NOT NULL,
  "endAt"         TIMESTAMP(3) NOT NULL,
  "reason"        TEXT NOT NULL,
  "scope"         "BookingLockScope" NOT NULL DEFAULT 'BRANCH',
  "vehicleIds"    INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "groupKeys"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "customersOnly" BOOLEAN NOT NULL DEFAULT false,
  "createdById"   INTEGER,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt"   TIMESTAMP(3),
  "cancelledById" INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS "BookingLock_publicId_key" ON "BookingLock"("publicId");
CREATE INDEX IF NOT EXISTS "BookingLock_branchId_cancelledAt_endAt_idx" ON "BookingLock"("branchId", "cancelledAt", "endAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BookingLock_branchId_fkey') THEN
    ALTER TABLE "BookingLock" ADD CONSTRAINT "BookingLock_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BookingLock_createdById_fkey') THEN
    ALTER TABLE "BookingLock" ADD CONSTRAINT "BookingLock_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BookingLock_cancelledById_fkey') THEN
    ALTER TABLE "BookingLock" ADD CONSTRAINT "BookingLock_cancelledById_fkey"
      FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
