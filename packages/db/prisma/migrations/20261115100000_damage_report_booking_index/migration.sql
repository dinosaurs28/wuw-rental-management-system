-- Nov 2026: Pending Settlements loads every returned booking's approved damages by
-- bookingId; DamageReport had no index on it. Guarded and re-runnable.
CREATE INDEX IF NOT EXISTS "DamageReport_bookingId_idx" ON "DamageReport"("bookingId");
