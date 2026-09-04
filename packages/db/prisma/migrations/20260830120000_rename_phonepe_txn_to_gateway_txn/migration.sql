-- Razorpay migration: PhonePe is no longer the payment gateway.
-- The column now holds a Razorpay order id (order_xxxxxxxxxxxx) for
-- customer self-pay extensions, so the gateway-specific name is dropped.
--
-- The rename is guarded because this must run against databases whose exact
-- state varies (some provisioned by `prisma db push` rather than migrate).
-- An unguarded ALTER ... RENAME COLUMN aborts the whole deploy if the column
-- is already renamed or absent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'BookingExtension'
      AND column_name = 'phonePeTransactionId'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'BookingExtension'
      AND column_name = 'gatewayTransactionId'
  ) THEN
    ALTER TABLE "BookingExtension"
      RENAME COLUMN "phonePeTransactionId" TO "gatewayTransactionId";
  END IF;
END $$;

-- Add the column outright if neither name is present (db push provisioning).
ALTER TABLE "BookingExtension"
  ADD COLUMN IF NOT EXISTS "gatewayTransactionId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "BookingExtension_gatewayTransactionId_key"
  ON "BookingExtension" ("gatewayTransactionId");

DROP INDEX IF EXISTS "BookingExtension_phonePeTransactionId_key";

-- Historical rows recorded under the retired gateway keep an explicit label so
-- reporting can still distinguish them from Razorpay transactions.
UPDATE "PaymentTransaction"
  SET "onlineGateway" = 'PHONEPE_LEGACY'
  WHERE "onlineGateway" = 'PHONEPE';
