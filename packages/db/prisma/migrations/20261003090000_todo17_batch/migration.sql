-- Oct 3 2026 batch: customer blacklist, UPI payment-proof photo, GST-inclusive
-- rent data points, credit ledger entries, offer posters, Razorpay UPI QR.
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is
-- guarded and every backfill only touches rows it has not filled yet.

ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'CREDIT';

-- ── Customer blacklist ──────────────────────────────────────────────────────
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "isBlacklisted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "blacklistReason" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "blacklistedAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "blacklistedById" INTEGER;
CREATE INDEX IF NOT EXISTS "Customer_isBlacklisted_idx" ON "Customer"("isBlacklisted");

-- ── Counter UPI payment proof photo ─────────────────────────────────────────
ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "proofFileId" INTEGER;
CREATE INDEX IF NOT EXISTS "PaymentTransaction_proofFileId_idx" ON "PaymentTransaction"("proofFileId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentTransaction_proofFileId_fkey') THEN
    ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_proofFileId_fkey"
      FOREIGN KEY ("proofFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── GST-inclusive rent data points ──────────────────────────────────────────
ALTER TABLE "VehicleCustomPricing" ADD COLUMN IF NOT EXISTS "totalRent12Hour" DECIMAL(10,2);
ALTER TABLE "VehicleCustomPricing" ADD COLUMN IF NOT EXISTS "totalRent24Hour" DECIMAL(10,2);
ALTER TABLE "VehicleCustomPricing" ADD COLUMN IF NOT EXISTS "rentWithoutGst12Hour" DECIMAL(10,2);
ALTER TABLE "VehicleCustomPricing" ADD COLUMN IF NOT EXISTS "rentWithoutGst24Hour" DECIMAL(10,2);
ALTER TABLE "BranchPricingDefaults" ADD COLUMN IF NOT EXISTS "totalRent12Hour" DECIMAL(10,2);
ALTER TABLE "BranchPricingDefaults" ADD COLUMN IF NOT EXISTS "totalRent24Hour" DECIMAL(10,2);
ALTER TABLE "BranchPricingDefaults" ADD COLUMN IF NOT EXISTS "rentWithoutGst12Hour" DECIMAL(10,2);
ALTER TABLE "BranchPricingDefaults" ADD COLUMN IF NOT EXISTS "rentWithoutGst24Hour" DECIMAL(10,2);

-- The configured 12 h / 24 h rent is now the GST-inclusive total. GST is the
-- branch's CGST% + SGST% OF THAT TOTAL (client rule: Rs 1300 -> Rs 234 GST,
-- Rs 1066 without GST), each half rounded to paise.
UPDATE "VehicleCustomPricing" p
   SET "totalRent24Hour" = ROUND(p."price24Hour"::numeric, 2)
 WHERE p."totalRent24Hour" IS NULL AND p."price24Hour" IS NOT NULL;
UPDATE "VehicleCustomPricing" p
   SET "totalRent12Hour" = ROUND(p."price12Hour"::numeric, 2)
 WHERE p."totalRent12Hour" IS NULL AND p."price12Hour" IS NOT NULL;
UPDATE "BranchPricingDefaults" p
   SET "totalRent24Hour" = ROUND(p."price24Hour"::numeric, 2)
 WHERE p."totalRent24Hour" IS NULL AND p."price24Hour" IS NOT NULL;
UPDATE "BranchPricingDefaults" p
   SET "totalRent12Hour" = ROUND(p."price12Hour"::numeric, 2)
 WHERE p."totalRent12Hour" IS NULL AND p."price12Hour" IS NOT NULL;

UPDATE "VehicleCustomPricing" p
   SET "rentWithoutGst24Hour" = p."totalRent24Hour"
         - ROUND(p."totalRent24Hour" * g."cgstRate" / 100, 2)
         - ROUND(p."totalRent24Hour" * g."sgstRate" / 100, 2)
  FROM "Vehicle" v JOIN "GSTRule" g ON g."branchId" = v."branchId"
 WHERE v."id" = p."vehicleId" AND p."rentWithoutGst24Hour" IS NULL AND p."totalRent24Hour" IS NOT NULL;
UPDATE "VehicleCustomPricing" p
   SET "rentWithoutGst12Hour" = p."totalRent12Hour"
         - ROUND(p."totalRent12Hour" * g."cgstRate" / 100, 2)
         - ROUND(p."totalRent12Hour" * g."sgstRate" / 100, 2)
  FROM "Vehicle" v JOIN "GSTRule" g ON g."branchId" = v."branchId"
 WHERE v."id" = p."vehicleId" AND p."rentWithoutGst12Hour" IS NULL AND p."totalRent12Hour" IS NOT NULL;
UPDATE "BranchPricingDefaults" p
   SET "rentWithoutGst24Hour" = p."totalRent24Hour"
         - ROUND(p."totalRent24Hour" * g."cgstRate" / 100, 2)
         - ROUND(p."totalRent24Hour" * g."sgstRate" / 100, 2)
  FROM "GSTRule" g
 WHERE g."branchId" = p."branchId" AND p."rentWithoutGst24Hour" IS NULL AND p."totalRent24Hour" IS NOT NULL;
UPDATE "BranchPricingDefaults" p
   SET "rentWithoutGst12Hour" = p."totalRent12Hour"
         - ROUND(p."totalRent12Hour" * g."cgstRate" / 100, 2)
         - ROUND(p."totalRent12Hour" * g."sgstRate" / 100, 2)
  FROM "GSTRule" g
 WHERE g."branchId" = p."branchId" AND p."rentWithoutGst12Hour" IS NULL AND p."totalRent12Hour" IS NOT NULL;

-- ── Offer posters ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PromoBanner" (
  "id"          SERIAL PRIMARY KEY,
  "publicId"    TEXT NOT NULL,
  "branchId"    INTEGER,
  "title"       TEXT NOT NULL,
  "subtitle"    TEXT,
  "imageFileId" INTEGER NOT NULL,
  "couponCode"  TEXT,
  "ctaLabel"    TEXT,
  "linkTarget"  TEXT,
  "startsAt"    TIMESTAMP(3) NOT NULL,
  "endsAt"      TIMESTAMP(3) NOT NULL,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdById" INTEGER NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "deletedAt"   TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "PromoBanner_publicId_key" ON "PromoBanner"("publicId");
CREATE INDEX IF NOT EXISTS "PromoBanner_branchId_isActive_startsAt_endsAt_idx"
  ON "PromoBanner"("branchId", "isActive", "startsAt", "endsAt");

-- ── Razorpay UPI QR payments ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "UpiQrPayment" (
  "id"          SERIAL PRIMARY KEY,
  "publicId"    TEXT NOT NULL,
  "qrId"        TEXT NOT NULL,
  "bookingId"   INTEGER NOT NULL,
  "purpose"     "PaymentPurpose" NOT NULL,
  "extensionId" INTEGER,
  "amount"      DECIMAL(10,2) NOT NULL,
  "imageUrl"    TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'ACTIVE',
  "paymentId"   TEXT,
  "closeBy"     TIMESTAMP(3) NOT NULL,
  "paidAt"      TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "UpiQrPayment_publicId_key" ON "UpiQrPayment"("publicId");
CREATE UNIQUE INDEX IF NOT EXISTS "UpiQrPayment_qrId_key" ON "UpiQrPayment"("qrId");
CREATE INDEX IF NOT EXISTS "UpiQrPayment_bookingId_idx" ON "UpiQrPayment"("bookingId");
CREATE INDEX IF NOT EXISTS "UpiQrPayment_status_idx" ON "UpiQrPayment"("status");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromoBanner_branchId_fkey') THEN
    ALTER TABLE "PromoBanner" ADD CONSTRAINT "PromoBanner_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PromoBanner_imageFileId_fkey') THEN
    ALTER TABLE "PromoBanner" ADD CONSTRAINT "PromoBanner_imageFileId_fkey"
      FOREIGN KEY ("imageFileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'UpiQrPayment_bookingId_fkey') THEN
    ALTER TABLE "UpiQrPayment" ADD CONSTRAINT "UpiQrPayment_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
