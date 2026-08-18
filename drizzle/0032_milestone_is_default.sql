-- Marks the four seeded phase milestones (Pre-Con, Kickoff, Punch, Complete).
--
-- These carry the phase link that auto-stamps actual_date when a project enters
-- that phase, so deleting one silently stops that phase from ever being
-- recorded. The flag is explicit rather than derived from `phase IS NOT NULL`
-- because create_milestone accepts a phase, so a user-created milestone could
-- otherwise become undeletable by accident.
ALTER TABLE "project_milestones" ADD COLUMN IF NOT EXISTS "is_default" boolean NOT NULL DEFAULT false;
