-- Oct 15 2026: festival pricing rules can add (or take off) a flat ₹ a day as
-- well as a percentage: rent × (1 + percent / 100) + flatAmount × (billed hours
-- / 24). Existing rules get 0 and price exactly as before; percent may now be 0
-- (a flat-only rule) — the app checks at least one of the two isn't 0.
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.

ALTER TABLE "SpecialPricingRule" ADD COLUMN IF NOT EXISTS "flatAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
