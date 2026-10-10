-- Oct 10 2026: pause and resume a Fleet Executive pickup or drop. One draft per
-- booking and type holds what was entered so far (readings, photo file ids,
-- choices); completing the pickup / drop deletes it.
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OperationDraftType') THEN
    CREATE TYPE "OperationDraftType" AS ENUM ('PICKUP', 'RETURN');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "OperationDraft" (
  "id"          SERIAL PRIMARY KEY,
  "publicId"    TEXT NOT NULL,
  "bookingId"   INTEGER NOT NULL,
  "type"        "OperationDraftType" NOT NULL,
  "data"        JSONB NOT NULL,
  "version"     INTEGER NOT NULL DEFAULT 1,
  "updatedById" INTEGER,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "OperationDraft_publicId_key" ON "OperationDraft"("publicId");
CREATE UNIQUE INDEX IF NOT EXISTS "OperationDraft_bookingId_type_key" ON "OperationDraft"("bookingId", "type");
CREATE INDEX IF NOT EXISTS "OperationDraft_updatedById_idx" ON "OperationDraft"("updatedById");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OperationDraft_bookingId_fkey') THEN
    ALTER TABLE "OperationDraft" ADD CONSTRAINT "OperationDraft_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OperationDraft_updatedById_fkey') THEN
    ALTER TABLE "OperationDraft" ADD CONSTRAINT "OperationDraft_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
