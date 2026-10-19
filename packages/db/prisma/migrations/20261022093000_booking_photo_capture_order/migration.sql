-- Oct 22 2026: vehicle condition photos keep the order they were taken in
-- (client request: "photo click madid order alli upload agbeku, plus ade order
-- alli drop time ge view madlike agbeku"). Uploads run in parallel and retry,
-- so they reach the server in a different order than the shots were taken;
-- each BookingPhoto now records its place in its set (pickup, swap delivery,
-- return, damage report), 0-based, in the order the photos were taken. Lists
-- sort by it, then by createdAt / id as before. Rows from before this keep NULL
-- (they list first, in the old order).
--
-- Re-runnable (the deploy step runs it on every deploy): every statement is guarded.

ALTER TABLE "BookingPhoto" ADD COLUMN IF NOT EXISTS "captureOrder" INTEGER;
