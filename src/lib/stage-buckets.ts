/**
 * Lifecycle buckets for the 4-column financial model (Budgeted / Planned /
 * In Process / Completed). A project's committed cost or actual spend sits
 * in exactly one bucket at a time, chosen by its current stage — see
 * src/lib/stages.ts for the full stage list these group.
 */
export const STAGE_BUCKETS = [
  { key: "planned", label: "Planned", stages: ["planned", "bidding", "ready"] },
  { key: "in_process", label: "In Process", stages: ["in_progress", "punch"] },
  { key: "completed", label: "Completed", stages: ["complete", "invoiced", "closed"] },
] as const;

export type StageBucketKey = (typeof STAGE_BUCKETS)[number]["key"];

const bucketByStage = new Map<string, StageBucketKey>(
  STAGE_BUCKETS.flatMap((b) => b.stages.map((s) => [s, b.key] as const)),
);

/** Unknown/missing stages default to "completed" — treated as realized spend. */
export function bucketForStage(stage: string | null | undefined): StageBucketKey {
  return (stage ? bucketByStage.get(stage) : undefined) ?? "completed";
}
