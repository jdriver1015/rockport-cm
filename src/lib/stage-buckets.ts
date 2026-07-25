/**
 * Lifecycle buckets for the 4-column financial model (Budgeted / Planned /
 * In Process / Completed). A project's committed cost or actual spend sits
 * in exactly one bucket at a time, chosen by its current phase.
 */
export const STAGE_BUCKETS = [
  { key: "planned", label: "Planned", phases: ["precon"] },
  { key: "in_process", label: "In Process", phases: ["in_process", "punch"] },
  { key: "completed", label: "Completed", phases: ["complete"] },
] as const;

export type StageBucketKey = (typeof STAGE_BUCKETS)[number]["key"];

const bucketByPhase = new Map<string, StageBucketKey>(
  STAGE_BUCKETS.flatMap((b) => b.phases.map((p) => [p, b.key] as const)),
);

/** Unknown/missing phases default to "completed" — treated as realized spend. */
export function bucketForPhase(phase: string | null | undefined): StageBucketKey {
  return (phase ? bucketByPhase.get(phase) : undefined) ?? "completed";
}
