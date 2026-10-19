-- Oct 23 2026: "Refund to customer" (client: "Option refund provided to customer
-- without any restrictions"). The branch manager or an admin pays money back on
-- any booking, any status, any amount — recorded as an OVERPAYMENT_REFUND
-- PaymentTransaction (idempotencyKey `ctr:`) and a COMPLETED RefundRequest.
-- goodwillAmount is the part of such a refund paid beyond what the booking owed
-- the customer back: it also comes off what the booking owes, so the balance due
-- doesn't rise. Every existing row (and every other refund) keeps 0.
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.

ALTER TABLE "PaymentTransaction" ADD COLUMN IF NOT EXISTS "goodwillAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
