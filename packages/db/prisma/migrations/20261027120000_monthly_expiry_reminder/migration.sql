-- Oct 27 2026: monthly rental expiry reminder (client TODO item 6).
-- 5 days before a monthly booking's endAt, the branch's Fleet Members (push +
-- inbox) and Branch Managers (inbox) get a MONTHLY_RENTAL_EXPIRING notification.
-- The sent marker is the Notification row (dedupeKey holds the endAt it was for,
-- unique per user), so no new column is needed.
--
-- Re-runnable (the deploy step runs it on every deploy): the statement is guarded.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'NotificationType' AND e.enumlabel = 'MONTHLY_RENTAL_EXPIRING'
  ) THEN
    ALTER TYPE "NotificationType" ADD VALUE 'MONTHLY_RENTAL_EXPIRING';
  END IF;
END $$;
