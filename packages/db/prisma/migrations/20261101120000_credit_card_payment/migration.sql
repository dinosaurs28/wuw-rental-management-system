-- Nov 1 2026 (client TODO 3): "Credit Card" counter payment method.
-- A counter card payment is a PaymentTransaction with method ONLINE and
-- onlineGateway 'CARD' (a free-text column — no schema change needed there),
-- backed by 1–3 receipt photos (PaymentTransactionProof, as for UPI).
-- The legacy invoice Payment.method / Booking.depositMethod / remainingPaymentMode
-- use the DepositMethod enum; it gains CARD so invoices and CSVs can tell a
-- card payment apart from UPI.
--
-- Re-runnable (the deploy step runs it on every deploy): guarded.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'DepositMethod' AND e.enumlabel = 'CARD'
  ) THEN
    ALTER TYPE "DepositMethod" ADD VALUE 'CARD';
  END IF;
END $$;
