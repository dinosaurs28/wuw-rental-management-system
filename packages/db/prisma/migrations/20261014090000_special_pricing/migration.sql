-- Oct 14 2026: festival (special-date) pricing. A branch manager (or admin) sets
-- a date range (IST calendar days, inclusive) and a percentage (−90 … +300) for
-- all vehicles, some categories or some vehicles of the branch; priced blocks
-- with at least half of their time on those days are billed at rent × (1 + %).
-- Soft-deleted (deletedAt); bookings keep the rules they were priced with in
-- pricingSnapshot.
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SpecialPricingScope') THEN
    CREATE TYPE "SpecialPricingScope" AS ENUM ('ALL', 'CATEGORIES', 'VEHICLES');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "SpecialPricingRule" (
  "id"          SERIAL PRIMARY KEY,
  "publicId"    TEXT NOT NULL,
  "branchId"    INTEGER NOT NULL,
  "name"        TEXT NOT NULL,
  "startDate"   DATE NOT NULL,
  "endDate"     DATE NOT NULL,
  "percent"     DECIMAL(6,2) NOT NULL,
  "scope"       "SpecialPricingScope" NOT NULL DEFAULT 'ALL',
  "categoryIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "vehicleIds"  INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "createdById" INTEGER,
  "updatedById" INTEGER,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "deletedAt"   TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "SpecialPricingRule_publicId_key" ON "SpecialPricingRule"("publicId");
CREATE INDEX IF NOT EXISTS "SpecialPricingRule_branchId_active_endDate_idx" ON "SpecialPricingRule"("branchId", "active", "endDate");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SpecialPricingRule_branchId_fkey') THEN
    ALTER TABLE "SpecialPricingRule" ADD CONSTRAINT "SpecialPricingRule_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SpecialPricingRule_createdById_fkey') THEN
    ALTER TABLE "SpecialPricingRule" ADD CONSTRAINT "SpecialPricingRule_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SpecialPricingRule_updatedById_fkey') THEN
    ALTER TABLE "SpecialPricingRule" ADD CONSTRAINT "SpecialPricingRule_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
