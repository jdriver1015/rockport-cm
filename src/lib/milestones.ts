import type { ProjectPhaseKey } from "@/lib/stages";

/**
 * The four milestones every project starts with, one per phase.
 *
 * The `phase` link is load-bearing, not decorative: setProjectPhase stamps
 * `actualDate` on the milestone matching the phase a project moves into, so
 * these rows are how a project's real phase dates get recorded. Deleting one
 * would silently stop that phase being captured, which is why they are seeded
 * on creation and protected from deletion and rename.
 *
 * Three of the four line up exactly with a phase entry — entering in_process is
 * work commencing, entering punch is work complete, entering complete is sign
 * off. "Contract Signed" is the exception: a project is created in precon, so
 * entering that phase says nothing about when a contract was signed. It is
 * recorded by hand and deliberately not derived from phase history.
 */
export const DEFAULT_MILESTONES: {
  label: string;
  phase: ProjectPhaseKey;
  sortOrder: number;
}[] = [
  { label: "Contract Signed", phase: "precon", sortOrder: 0 },
  { label: "Work Commence", phase: "in_process", sortOrder: 1 },
  { label: "Work Completed", phase: "punch", sortOrder: 2 },
  { label: "Punch and Sign Off", phase: "complete", sortOrder: 3 },
];

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
