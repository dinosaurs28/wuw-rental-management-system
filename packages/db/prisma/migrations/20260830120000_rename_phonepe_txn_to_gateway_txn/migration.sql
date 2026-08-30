-- Razorpay migration: PhonePe is no longer the payment gateway.
-- The column now holds a Razorpay order id (order_xxxxxxxxxxxx) for
-- customer self-pay extensions, so the gateway-specific name is dropped.
ALTER TABLE "BookingExtension"
  RENAME COLUMN "phonePeTransactionId" TO "gatewayTransactionId";

ALTER INDEX IF EXISTS "BookingExtension_phonePeTransactionId_key"
  RENAME TO "BookingExtension_gatewayTransactionId_key";

-- Historical rows recorded under the retired gateway keep an explicit label so
-- reporting can still distinguish them from Razorpay transactions.
UPDATE "PaymentTransaction"
  SET "onlineGateway" = 'PHONEPE_LEGACY'
  WHERE "onlineGateway" = 'PHONEPE';
