-- Oct 20 2026: an optional note the Fleet Executive writes at the pickup and at
-- the drop ("During Pickup and Drop add an optional Note section"). One note per
-- booking and step; shown at the drop and to the branch manager (rent history,
-- customer booking, completed records). Never returned to customers.
-- writtenById / editedById are User ids (no relation, like Booking.licenseCollectedById).
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OperationNoteType') THEN
    CREATE TYPE "OperationNoteType" AS ENUM ('PICKUP', 'DROP');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "BookingOperationNote" (
  "id"          SERIAL PRIMARY KEY,
  "bookingId"   INTEGER NOT NULL,
  "type"        "OperationNoteType" NOT NULL,
  "note"        TEXT NOT NULL,
  "writtenById" INTEGER,
  "writtenAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "editedById"  INTEGER,
  "editedAt"    TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "BookingOperationNote_bookingId_type_key" ON "BookingOperationNote"("bookingId", "type");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BookingOperationNote_bookingId_fkey') THEN
    ALTER TABLE "BookingOperationNote" ADD CONSTRAINT "BookingOperationNote_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
