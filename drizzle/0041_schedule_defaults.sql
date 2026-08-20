-- Suggested schedule for a new unit turn.
--
-- The wizard's Vendor & dates step asked for three free-floating dates with no
-- defaults, so every project was typed from scratch and nothing stopped target
-- completion landing before the pre-walk. These are the offsets that turn "a
-- unit turn takes about two and a half weeks" into filled-in dates.
--
-- Offsets are DAYS FROM THE DAY THE PROJECT IS CREATED, all measured from that
-- one origin rather than chained off each other. A chain reads as a plan
-- ("mobilize three days after signing") but means an edit to one date silently
-- moves every later one; from a single origin each suggested date is
-- independently explainable and editing one changes only that one.
ALTER TABLE "interior_default_settings"
  ADD COLUMN IF NOT EXISTS "schedule_enabled" boolean NOT NULL DEFAULT true;

-- Keyed by project phase, not by milestone label: the four default milestones
-- were renamed once already (Pre-Con/Kickoff/Punch/Complete became Drew's
-- wording), and a phase key survives that. "pre_walk" is the exception — it is
-- not a milestone, it is the walk that produces the scope, and it lives on the
-- project row.
--
-- Defaults: sign in a week, mobilize three days later, two weeks of work, then
-- four days of punch — about two and a half weeks from commencement to sign-off.
ALTER TABLE "interior_default_settings"
  ADD COLUMN IF NOT EXISTS "schedule_offsets" jsonb NOT NULL
  DEFAULT '{"pre_walk":2,"precon":7,"in_process":10,"punch":24,"complete":28}'::jsonb;
