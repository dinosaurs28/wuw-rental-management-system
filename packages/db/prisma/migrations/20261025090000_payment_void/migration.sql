-- Oct 25 2026: void a payment (client: "you need be able to void some payment").
-- The branch manager, admin or Fleet Executive reverses a CONFIRMED
-- staff-recorded entry made by mistake (cash / UPI / bank transfer, refunds
-- included). The row is kept with status VOIDED and who / when / why; it is
-- counted in no total. A voided refund's RefundRequest becomes VOIDED too.
-- voidShiftClosed: the entry's cash shift was already closed when it was voided.
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.
-- The new enum values are not used in this file (a value added in a
-- transaction can't be used before it commits).

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'PaymentTransactionStatus' AND e.enumlabel = 'VOIDED'
  ) THEN
    ALTER TYPE "PaymentTransactionStatus" ADD VALUE 'VOIDED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'RefundStatus' AND e.enumlabel = 'VOIDED'
  ) THEN
    ALTER TYPE "RefundStatus" ADD VALUE 'VOIDED';
  END IF;
END $$;

ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3);
ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "voidedById" INTEGER;
ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "voidReason" TEXT;
ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "voidShiftClosed" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "PaymentTransaction_branchId_voidedAt_idx" ON "PaymentTransaction"("branchId", "voidedAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentTransaction_voidedById_fkey') THEN
    ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_voidedById_fkey"
      FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
