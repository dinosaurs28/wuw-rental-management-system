-- Oct 19 2026: office hours are 8:00 AM – 11:00 PM (last pickup 10:30 PM, which
-- the app derives as closing − 30 min). Branches that saved 08:00–22:30 (Manipal,
-- every day) move to 08:00–23:00. Rows with any other hours are left alone, and
-- branches without saved rows already use the 08:00–23:00 default.
--
-- Re-runnable (the deploy step runs it on every deploy): it applies ONCE. A
-- marker in the BranchSchedule table comment records that it ran, so a branch
-- manager who later saves 08:00–22:30 on purpose keeps it on later deploys.

DO $$
DECLARE
  marker CONSTANT text := 'branch_hours_11pm applied';
  current_comment text := obj_description('"BranchSchedule"'::regclass, 'pg_class');
BEGIN
  IF current_comment IS NULL OR position(marker IN current_comment) = 0 THEN
    UPDATE "BranchSchedule"
       SET "closeTime" = '23:00'
     WHERE "openTime" = '08:00' AND "closeTime" = '22:30';
    EXECUTE format(
      'COMMENT ON TABLE "BranchSchedule" IS %L',
      CASE WHEN current_comment IS NULL OR current_comment = '' THEN marker
           ELSE current_comment || '; ' || marker END
    );
  END IF;
END $$;
