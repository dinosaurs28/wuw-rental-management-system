-- Nov 26 2026: cash shifts close automatically at the end of their IST day
-- (jobs/cashShiftAutoClose.worker.ts). Column only; existing shifts keep NULL.
-- Re-runnable (IF NOT EXISTS).
ALTER TABLE "CashShift" ADD COLUMN IF NOT EXISTS "autoClosedAt" TIMESTAMP(3);
