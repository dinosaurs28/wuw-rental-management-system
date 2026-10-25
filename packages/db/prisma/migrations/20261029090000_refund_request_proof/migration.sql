-- Oct 25 2026: refund request mark-paid by UPI / bank transfer needs the photo of
-- the refund's payment-success screen. Guarded and re-runnable.
ALTER TABLE "RefundRequest" ADD COLUMN IF NOT EXISTS "proofFileId" INTEGER;
CREATE INDEX IF NOT EXISTS "RefundRequest_proofFileId_idx" ON "RefundRequest"("proofFileId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RefundRequest_proofFileId_fkey') THEN
    ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_proofFileId_fkey"
      FOREIGN KEY ("proofFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
