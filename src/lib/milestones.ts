import { PROJECT_PHASES, type ProjectPhaseKey } from "@/lib/stages";

/**
 * The four rows every project starts with — one per phase.
 *
 * There is one concept here now: phases. These rows used to carry their own
 * names (Contract Signed, Work Commence, Work Completed, Punch and Sign Off)
 * alongside the four phases, which meant two vocabularies for the same four
 * steps and a project header that could say "Punch and Sign-Off" while the row
 * beneath it said something else. The labels are derived from PROJECT_PHASES
 * instead, so they cannot drift apart again.
 *
 * The `phase` link is load-bearing: setProjectPhase stamps `actualDate` on the
 * row matching the phase a project moves into, so these rows are how a
 * project's real phase dates get recorded. Deleting one would silently stop
 * that phase being captured, which is why they are seeded on creation and
 * protected from deletion and rename.
 *
 * One asymmetry survives the merge: a project is created already in pre-con, so
 * no phase-entry event ever fires for it and the Pre-Construction row's actual
 * date has to be set by hand. The other three stamp themselves.
 *
 * The module and the `project_milestones` table keep their old names for now —
 * renaming a table is a migration with no user-visible payoff, and every name a
 * person actually reads already says phase.
 */
export const DEFAULT_MILESTONES: {
  label: string;
  phase: ProjectPhaseKey;
  sortOrder: number;
}[] = PROJECT_PHASES.map((p, i) => ({ label: p.label, phase: p.key, sortOrder: i }));

/** Rows to insert for a newly created project. */
export function defaultMilestoneRows(projectId: number) {
  return DEFAULT_MILESTONES.map((m) => ({
    projectId,
    label: m.label,
    phase: m.phase,
    sortOrder: m.sortOrder,
    isDefault: true,
  }));
}

/** Customs sort after the four defaults rather than colliding at sortOrder 0. */
export const FIRST_CUSTOM_SORT_ORDER = DEFAULT_MILESTONES.length;
