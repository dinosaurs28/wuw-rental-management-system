-- Oct 16 2026: full edit of a completed pickup / drop (client item 1, "Full Pickup
-- and Drop Flow should be editable"). The money difference of an edit is settled
-- on a payment session of the new type ADJUSTMENT: delta ledger lines (new − old)
-- plus the payment / refund recorded with the usual counter methods. Past
-- sessions, ledger lines and payments are never changed.
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.

ALTER TYPE "PaymentSessionType" ADD VALUE IF NOT EXISTS 'ADJUSTMENT';
