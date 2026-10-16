-- Oct 18 2026: drop screens show pickup / swap photos large. Each public photo
-- upload now also stores a ~1200 px "display" JPEG beside the original; its R2
-- key is kept here (null = none yet: older photos get one on first view).
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.

ALTER TABLE "FileObject" ADD COLUMN IF NOT EXISTS "displayKey" TEXT;
