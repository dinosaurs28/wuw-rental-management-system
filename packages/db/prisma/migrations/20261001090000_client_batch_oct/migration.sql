-- Oct 2026 client batch: identity numbers, QR photo, DL status, trip tags,
-- extension GST split, swap readings, cash-shift float, invoice GST split,
-- notifications, password-reset tokens.
--
-- Re-runnable: every statement is guarded (IF NOT EXISTS / pg_type /
-- pg_constraint checks) and every backfill only touches rows it has not
-- filled yet, because the deploy step runs this file on every deploy.

-- ── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DlCollectionStatus') THEN
    CREATE TYPE "DlCollectionStatus" AS ENUM ('COLLECTED', 'NOT_COLLECTED', 'DEPOSIT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VehicleUseCase') THEN
    CREATE TYPE "VehicleUseCase" AS ENUM ('HIGHWAY', 'HILL_STATION', 'LONG_DRIVE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationType') THEN
    CREATE TYPE "NotificationType" AS ENUM (
      'BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'BOOKING_DISPLACED',
      'PAYMENT_NEEDS_REFUND', 'REFUND_COMPLETED', 'EXTENSION_CONFIRMED',
      'EXTENSION_REJECTED', 'PICKUP_COMPLETED', 'PICKUP_APPROVAL_REQUESTED',
      'RETURN_COMPLETED', 'RETURN_APPROVAL_REQUESTED', 'RETURN_OVERDUE',
      'DAMAGE_REPORTED', 'DAMAGE_CHARGED', 'VEHICLE_SWAPPED',
      'APPROVAL_REQUESTED', 'APPROVAL_RESOLVED', 'CASH_DELAYED',
      'SHIFT_DISCREPANCY'
    );
  END IF;
END $$;

ALTER TYPE "LedgerEntryType" ADD VALUE IF NOT EXISTS 'VEHICLE_SWAP';
ALTER TYPE "ChargeType" ADD VALUE IF NOT EXISTS 'VEHICLE_SWAP';

-- ── Customer: identity numbers + QR photo ───────────────────────────────────
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "drivingLicenceNumber" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "aadhaarNumber" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "qrPhotoFileId" INTEGER;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "qrPhotoCapturedAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "qrPhotoCapturedById" INTEGER;
CREATE INDEX IF NOT EXISTS "Customer_drivingLicenceNumber_idx" ON "Customer"("drivingLicenceNumber");
CREATE INDEX IF NOT EXISTS "Customer_aadhaarNumber_idx" ON "Customer"("aadhaarNumber");
CREATE INDEX IF NOT EXISTS "Customer_qrPhotoFileId_idx" ON "Customer"("qrPhotoFileId");

-- DL and Aadhaar numbers are now part of a complete profile. Existing
-- customers without them must add them before their NEXT booking; confirmed
-- and in-progress bookings never read this flag.
UPDATE "Customer"
   SET "isProfileCompleted" = false
 WHERE "isProfileCompleted" = true
   AND ("drivingLicenceNumber" IS NULL OR "drivingLicenceNumber" = ''
        OR "aadhaarNumber" IS NULL OR "aadhaarNumber" = '');

-- ── Booking: DL status, QR snapshot, actual return time ─────────────────────
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "dlStatus" "DlCollectionStatus";
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "dlStatusUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "dlStatusUpdatedById" INTEGER;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "dlDepositNote" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "qrPhotoFileId" INTEGER;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "returnedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Booking_qrPhotoFileId_idx" ON "Booking"("qrPhotoFileId");
CREATE INDEX IF NOT EXISTS "Booking_branchId_status_rentalPeriodType_idx"
  ON "Booking"("branchId", "status", "rentalPeriodType");

UPDATE "Booking"
   SET "dlStatus" = 'COLLECTED'
 WHERE "dlStatus" IS NULL AND "licenseCollectedAt" IS NOT NULL;

-- Walk-in bookings never stored their rental period type. Classify the
-- missing ones by booked length, using DurationCalculatorService's bands
-- (> 708 h bills as 720 h = MONTHLY).
UPDATE "Booking"
   SET "rentalPeriodType" = CASE
         WHEN EXTRACT(EPOCH FROM ("endAt" - "startAt")) / 3600 <= 1   THEN 'HOURLY'::"RentalPeriodType"
         WHEN EXTRACT(EPOCH FROM ("endAt" - "startAt")) / 3600 <= 12  THEN 'HALF_DAY'::"RentalPeriodType"
         WHEN EXTRACT(EPOCH FROM ("endAt" - "startAt")) / 3600 <= 24  THEN 'FULL_DAY'::"RentalPeriodType"
         WHEN EXTRACT(EPOCH FROM ("endAt" - "startAt")) / 3600 > 708  THEN 'MONTHLY'::"RentalPeriodType"
         ELSE 'MULTI_DAY'::"RentalPeriodType"
       END
 WHERE "rentalPeriodType" IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Customer_qrPhotoFileId_fkey') THEN
    ALTER TABLE "Customer" ADD CONSTRAINT "Customer_qrPhotoFileId_fkey"
      FOREIGN KEY ("qrPhotoFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Booking_qrPhotoFileId_fkey') THEN
    ALTER TABLE "Booking" ADD CONSTRAINT "Booking_qrPhotoFileId_fkey"
      FOREIGN KEY ("qrPhotoFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── Vehicle: trip-type tags ─────────────────────────────────────────────────
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "useCases" "VehicleUseCase"[] NOT NULL DEFAULT ARRAY[]::"VehicleUseCase"[];

-- ── BookingExtension: GST split ─────────────────────────────────────────────
ALTER TABLE "BookingExtension" ADD COLUMN IF NOT EXISTS "baseAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "BookingExtension" ADD COLUMN IF NOT EXISTS "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "BookingExtension" ADD COLUMN IF NOT EXISTS "taxableAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "BookingExtension" ADD COLUMN IF NOT EXISTS "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "BookingExtension" ADD COLUMN IF NOT EXISTS "cgstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "BookingExtension" ADD COLUMN IF NOT EXISTS "sgstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "BookingExtension" ADD COLUMN IF NOT EXISTS "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- Older extensions stored only the GST-inclusive additionalAmount. Split it
-- with the branch's CGST+SGST so invoices stop taxing it a second time.
WITH r AS (
  SELECT e."id",
         e."additionalAmount" AS gross,
         (g."cgstRate" + g."sgstRate") AS rate,
         ROUND(e."additionalAmount" / (1 + (g."cgstRate" + g."sgstRate") / 100), 2) AS taxable
    FROM "BookingExtension" e
    JOIN "GSTRule" g ON g."branchId" = e."branchId"
   WHERE e."additionalAmount" > 0
     AND e."taxableAmount" = 0
     AND e."taxAmount" = 0
)
UPDATE "BookingExtension" e
   SET "taxRate"       = r.rate,
       "baseAmount"    = r.taxable,
       "taxableAmount" = r.taxable,
       "taxAmount"     = r.gross - r.taxable,
       "cgstAmount"    = ROUND((r.gross - r.taxable) / 2, 2),
       "sgstAmount"    = (r.gross - r.taxable) - ROUND((r.gross - r.taxable) / 2, 2)
  FROM r
 WHERE e."id" = r."id";

-- ── VehicleSwap: mid-rental readings + price difference ─────────────────────
ALTER TABLE "VehicleSwap" ADD COLUMN IF NOT EXISTS "bookingStatusAtSwap" "BookingStatus";
ALTER TABLE "VehicleSwap" ADD COLUMN IF NOT EXISTS "originalVehicleEndOdometer" INTEGER;
ALTER TABLE "VehicleSwap" ADD COLUMN IF NOT EXISTS "originalVehicleFuelLevel" TEXT;
ALTER TABLE "VehicleSwap" ADD COLUMN IF NOT EXISTS "newVehicleStartOdometer" INTEGER;
ALTER TABLE "VehicleSwap" ADD COLUMN IF NOT EXISTS "newVehicleFuelLevel" TEXT;
ALTER TABLE "VehicleSwap" ADD COLUMN IF NOT EXISTS "priceDifference" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "VehicleSwap" ADD COLUMN IF NOT EXISTS "chargeDifference" BOOLEAN NOT NULL DEFAULT false;

-- ── CashShift: opening float + close-time cash snapshots ────────────────────
ALTER TABLE "CashShift" ADD COLUMN IF NOT EXISTS "openingCash" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "CashShift" ADD COLUMN IF NOT EXISTS "cashCollected" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "CashShift" ADD COLUMN IF NOT EXISTS "cashRefunded" DECIMAL(10,2) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "CashShift_branchId_openedAt_idx" ON "CashShift"("branchId", "openedAt");

-- Closed shifts from before this change: derive the snapshots from their
-- linked transactions. Stored expectedTotal/discrepancy are left untouched.
UPDATE "CashShift" s
   SET "cashCollected" = COALESCE((
         SELECT SUM(t."cashAmount") FROM "PaymentTransaction" t
          WHERE t."cashShiftId" = s."id"
            AND t."status" IN ('COLLECTED', 'CONFIRMED')
            AND t."purpose" NOT IN ('OVERPAYMENT_REFUND', 'CANCELLATION_REFUND')), 0),
       "cashRefunded" = COALESCE((
         SELECT SUM(t."cashAmount") FROM "PaymentTransaction" t
          WHERE t."cashShiftId" = s."id"
            AND t."status" = 'CONFIRMED'
            AND t."purpose" IN ('OVERPAYMENT_REFUND', 'CANCELLATION_REFUND')), 0)
 WHERE s."status" <> 'OPEN'
   AND s."cashCollected" = 0
   AND s."cashRefunded" = 0;

-- ── Invoice / InvoiceItem / CreditNote: GST split ───────────────────────────
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "taxableAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "cgstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "sgstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "depositAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "InvoiceItem" ADD COLUMN IF NOT EXISTS "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "InvoiceItem" ADD COLUMN IF NOT EXISTS "sourceRef" TEXT;
ALTER TABLE "CreditNote" ADD COLUMN IF NOT EXISTS "taxableAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "CreditNote" ADD COLUMN IF NOT EXISTS "cgstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "CreditNote" ADD COLUMN IF NOT EXISTS "sgstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- ── PasswordResetToken (no earlier migration ever created it) ───────────────
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
  "id"        SERIAL PRIMARY KEY,
  "userId"    INTEGER NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "used"      BOOLEAN NOT NULL DEFAULT false,
  "usedAt"    TIMESTAMP(3),
  "requestIp" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PasswordResetToken_userId_fkey') THEN
    ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ── Notifications ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Notification" (
  "id"        SERIAL PRIMARY KEY,
  "publicId"  TEXT NOT NULL,
  "userId"    INTEGER NOT NULL,
  "branchId"  INTEGER,
  "bookingId" INTEGER,
  "type"      "NotificationType" NOT NULL,
  "title"     TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "data"      JSONB,
  "dedupeKey" TEXT NOT NULL,
  "readAt"    TIMESTAMP(3),
  "pushedAt"  TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_publicId_key" ON "Notification"("publicId");
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_bookingId_idx" ON "Notification"("bookingId");

CREATE TABLE IF NOT EXISTS "PushToken" (
  "id"        SERIAL PRIMARY KEY,
  "userId"    INTEGER NOT NULL,
  "token"     TEXT NOT NULL,
  "platform"  TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "PushToken_token_key" ON "PushToken"("token");
CREATE INDEX IF NOT EXISTS "PushToken_userId_idx" ON "PushToken"("userId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_userId_fkey') THEN
    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_branchId_fkey') THEN
    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Notification_bookingId_fkey') THEN
    ALTER TABLE "Notification" ADD CONSTRAINT "Notification_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PushToken_userId_fkey') THEN
    ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── ChargeEntry: GST frozen on legacy (non-Unified-Payments) drop charges ──
ALTER TABLE "ChargeEntry" ADD COLUMN IF NOT EXISTS "gstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "ChargeEntry" ADD COLUMN IF NOT EXISTS "cgstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "ChargeEntry" ADD COLUMN IF NOT EXISTS "sgstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "ChargeEntry" ADD COLUMN IF NOT EXISTS "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- Coupon usage is released per booking (deleteMany by bookingId)
CREATE INDEX IF NOT EXISTS "CouponUsageLog_bookingId_idx" ON "CouponUsageLog"("bookingId");
