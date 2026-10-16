-- Oct 20 2026: the customer "Trip type" filter offers two options — LOCAL
-- ("Udupi/Manipal") and OUT_OF_UDUPI ("Out of Udupi") — instead of Highway /
-- Hill Station / Long Drive. The old enum values stay in the type (Postgres
-- can't drop enum values) but the app never stores or offers them again.
--
-- Re-runnable (the deploy step runs it on every deploy).
--
-- 1. The new enum values. A value added by ALTER TYPE … ADD VALUE can't be used
--    until the transaction that added it commits, and `prisma db execute` sends
--    the whole file as one implicit transaction — so the additions are committed
--    on their own before the data step below uses them.

BEGIN;
ALTER TYPE "VehicleUseCase" ADD VALUE IF NOT EXISTS 'LOCAL';
ALTER TYPE "VehicleUseCase" ADD VALUE IF NOT EXISTS 'OUT_OF_UDUPI';
COMMIT;

-- 2. One-time retag. Every live vehicle gets LOCAL; a vehicle tagged with any of
--    HIGHWAY / HILL_STATION / LONG_DRIVE also gets OUT_OF_UDUPI, and the old
--    values are removed (a deleted vehicle only has its old values mapped).
--    It applies ONCE: a marker in the Vehicle table comment records that it ran,
--    so tags a branch manager or admin edits later are never overwritten.

DO $$
DECLARE
  marker CONSTANT text := 'trip_types_local applied';
  current_comment text := obj_description('"Vehicle"'::regclass, 'pg_class');
BEGIN
  IF current_comment IS NULL OR position(marker IN current_comment) = 0 THEN
    UPDATE "Vehicle"
       SET "useCases" =
             CASE WHEN "deletedAt" IS NULL THEN ARRAY['LOCAL']::"VehicleUseCase"[]
                  ELSE ARRAY[]::"VehicleUseCase"[] END
             ||
             CASE WHEN "useCases" && ARRAY['HIGHWAY', 'HILL_STATION', 'LONG_DRIVE', 'OUT_OF_UDUPI']::"VehicleUseCase"[]
                  THEN ARRAY['OUT_OF_UDUPI']::"VehicleUseCase"[]
                  ELSE ARRAY[]::"VehicleUseCase"[] END
     WHERE "deletedAt" IS NULL
        OR "useCases" && ARRAY['HIGHWAY', 'HILL_STATION', 'LONG_DRIVE']::"VehicleUseCase"[];
    EXECUTE format(
      'COMMENT ON TABLE "Vehicle" IS %L',
      CASE WHEN current_comment IS NULL OR current_comment = '' THEN marker
           ELSE current_comment || '; ' || marker END
    );
  END IF;
END $$;
