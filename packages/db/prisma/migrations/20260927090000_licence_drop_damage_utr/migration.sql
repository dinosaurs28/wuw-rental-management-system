-- Original driving licence custody, damage billed at drop, UTR lookups.
--
-- Guarded with IF NOT EXISTS because some databases were provisioned with
-- `prisma db push` rather than migrate, so their exact state varies.

-- Original (physical) driving licence collected at pickup / returned at drop
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "licenseCollectedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "licenseCollectedById" INTEGER;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "licenseReturnedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "licenseReturnedById" INTEGER;

-- Damage whose cost staff billed on the RETURN session ledger at drop
ALTER TABLE "DamageReport" ADD COLUMN IF NOT EXISTS "chargedAtDrop" BOOLEAN NOT NULL DEFAULT false;

-- Duplicate-UTR checks look payments up by their reference
CREATE INDEX IF NOT EXISTS "PaymentTransaction_onlineTransactionRef_idx"
  ON "PaymentTransaction" ("onlineTransactionRef");
