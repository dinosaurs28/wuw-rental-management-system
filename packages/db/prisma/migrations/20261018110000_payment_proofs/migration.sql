-- Oct 18 2026: up to three UPI payment-screen photos per counter payment (a
-- customer may pay in several UPI transactions). PaymentTransaction.proofFileId
-- stays the first photo, so older readers keep working; no backfill (readers
-- fall back to proofFileId when a payment has no rows here).
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.

CREATE TABLE IF NOT EXISTS "PaymentTransactionProof" (
  "id" SERIAL NOT NULL,
  "transactionId" INTEGER NOT NULL,
  "fileId" INTEGER NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentTransactionProof_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTransactionProof_transactionId_position_key"
  ON "PaymentTransactionProof"("transactionId", "position");
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTransactionProof_transactionId_fileId_key"
  ON "PaymentTransactionProof"("transactionId", "fileId");
CREATE INDEX IF NOT EXISTS "PaymentTransactionProof_fileId_idx"
  ON "PaymentTransactionProof"("fileId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentTransactionProof_transactionId_fkey') THEN
    ALTER TABLE "PaymentTransactionProof" ADD CONSTRAINT "PaymentTransactionProof_transactionId_fkey"
      FOREIGN KEY ("transactionId") REFERENCES "PaymentTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentTransactionProof_fileId_fkey') THEN
    ALTER TABLE "PaymentTransactionProof" ADD CONSTRAINT "PaymentTransactionProof_fileId_fkey"
      FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
