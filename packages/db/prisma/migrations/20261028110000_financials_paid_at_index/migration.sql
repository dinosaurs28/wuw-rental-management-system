-- BM Financials view (Oct 2026): payments of a branch by the date collected
-- (COALESCE(collectedAt, createdAt), IST day ranges), newest first, a year at a time.
-- Expression index — not expressible in schema.prisma, so it lives here only
-- (a `prisma db push` would not create it; deploys run this migration loop).
-- Guarded: re-runnable.
CREATE INDEX IF NOT EXISTS "PaymentTransaction_branchId_paidAt_idx"
  ON "PaymentTransaction" ("branchId", (COALESCE("collectedAt", "createdAt")));
