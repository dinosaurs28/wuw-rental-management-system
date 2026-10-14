-- Oct 16 2026: festival pricing per vehicle group (client feedback on the
-- festival dialog). A rule of the new scope GROUPS carries one change per
-- vehicle group — the branch's vehicles of one make + model + category — as
-- SpecialPricingRuleItem rows: PERCENT (rent × (1 + value / 100)) or FLAT
-- (value ₹ a day shared by the billed hours); value is signed, negative = off.
-- Rules of the other scopes keep their percent / flatAmount and price as before.
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.

ALTER TYPE "SpecialPricingScope" ADD VALUE IF NOT EXISTS 'GROUPS';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SpecialPricingChange') THEN
    CREATE TYPE "SpecialPricingChange" AS ENUM ('PERCENT', 'FLAT');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "SpecialPricingRuleItem" (
  "id"         SERIAL PRIMARY KEY,
  "ruleId"     INTEGER NOT NULL,
  "groupKey"   TEXT NOT NULL,
  "make"       TEXT NOT NULL,
  "model"      TEXT NOT NULL,
  "categoryId" INTEGER NOT NULL,
  "type"       "SpecialPricingChange" NOT NULL,
  "value"      DECIMAL(10,2) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "SpecialPricingRuleItem_ruleId_groupKey_key" ON "SpecialPricingRuleItem"("ruleId", "groupKey");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SpecialPricingRuleItem_ruleId_fkey') THEN
    ALTER TABLE "SpecialPricingRuleItem" ADD CONSTRAINT "SpecialPricingRuleItem_ruleId_fkey"
      FOREIGN KEY ("ruleId") REFERENCES "SpecialPricingRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
