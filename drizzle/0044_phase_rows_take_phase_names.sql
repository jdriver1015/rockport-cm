-- One vocabulary for the four steps.
--
-- The seeded rows carried their own names (Contract Signed, Work Commence,
-- Work Completed, Punch and Sign Off) alongside the four phase labels, so the
-- same four steps had two sets of names and a project header could read
-- "Punch and Sign Off" while the row beneath it said "Work Completed". The rows
-- now take the phase's name, and src/lib/milestones.ts derives new ones from
-- PROJECT_PHASES so they cannot drift apart again.
--
-- Supersedes 0033, which renamed these to the previous set. Custom rows are
-- untouched — their labels are the user's own words.
UPDATE "project_milestones"
SET "label" = CASE "phase"
    WHEN 'precon' THEN 'Pre-Construction'
    WHEN 'in_process' THEN 'In Process'
    WHEN 'punch' THEN 'Punch and Sign Off'
    WHEN 'complete' THEN 'Complete'
    ELSE "label"
  END
WHERE "is_default" = true AND "phase" IS NOT NULL;
