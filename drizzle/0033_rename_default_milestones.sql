-- Rename the four seeded milestones to the agreed operating wording. Matched on
-- phase, not the old label, so the rename is independent of what they were
-- called before. Labels are locked in the UI, so this is the only way they move.
UPDATE "project_milestones" SET "label" = 'Contract Signed'
  WHERE "is_default" AND "phase" = 'precon' AND "label" <> 'Contract Signed';
UPDATE "project_milestones" SET "label" = 'Work Commence'
  WHERE "is_default" AND "phase" = 'in_process' AND "label" <> 'Work Commence';
UPDATE "project_milestones" SET "label" = 'Work Completed'
  WHERE "is_default" AND "phase" = 'punch' AND "label" <> 'Work Completed';
UPDATE "project_milestones" SET "label" = 'Punch and Sign Off'
  WHERE "is_default" AND "phase" = 'complete' AND "label" <> 'Punch and Sign Off';

-- The precon milestone's dates were derived from phase history when it meant
-- "Pre-Con": actual came from the project's creation event, planned from
-- pre_walk_date. Neither is a contract signing, so carrying them onto "Contract
-- Signed" would invent a date that never happened. Clear only the values that
-- still exactly match their derived source — anything edited by hand differs
-- and is left alone.
UPDATE "project_milestones" m SET "actual_date" = NULL
  FROM "projects" p
  WHERE p."id" = m."project_id" AND m."is_default" AND m."phase" = 'precon'
    AND m."actual_date" = p."created_at"::date;

UPDATE "project_milestones" m SET "planned_date" = NULL
  FROM "projects" p
  WHERE p."id" = m."project_id" AND m."is_default" AND m."phase" = 'precon'
    AND m."planned_date" IS NOT NULL
    AND m."planned_date" = p."pre_walk_date";
