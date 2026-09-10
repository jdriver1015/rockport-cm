import type { ProjectPhaseKey } from "@/lib/stages";

/**
 * The two gated walks, described once.
 *
 * A pre-walk and a punch walk are the same thing at opposite ends of a job:
 * somebody walks the work with a phone, shoots what they see, writes it up. One
 * produces the scope, the other checks it was done. They differ in four facts —
 * a label, which project columns hold the booking, which phase gate they
 * satisfy, and what their findings turn into — and in nothing else.
 *
 * Kept as data rather than as two implementations. The alternative is copying
 * PreWalkDialog into PunchWalkDialog and watching them drift, which is a
 * failure this codebase has elsewhere and does not need again.
 *
 * Deliberately free of any schema or database import: the dialog is a client
 * component and reads the labels from here.
 */

export const WALK_KINDS = ["pre_walk", "punch_walk"] as const;
export type WalkKind = (typeof WALK_KINDS)[number];

export function isWalkKind(value: string | null | undefined): value is WalkKind {
  return value === "pre_walk" || value === "punch_walk";
}

export type WalkKindConfig = {
  key: WalkKind;
  /** Title case, for buttons and gate labels: "Pre-Walk". */
  label: string;
  /** Sentence case, for the audit title: "Retreat Unit 12 — Pre-walk". */
  titleWord: string;
  /** The phase a project must be in for this walk to be the one that matters. */
  phase: ProjectPhaseKey;
  /** What the walk is for, in the words used on screen. */
  purpose: string;
  /** What its findings become once the walk is done. */
  findingsBecome: string;
};

export const WALK_KIND: Record<WalkKind, WalkKindConfig> = {
  pre_walk: {
    key: "pre_walk",
    label: "Pre-Walk",
    titleWord: "Pre-walk",
    phase: "precon",
    purpose: "Walk the unit before pricing it, so the scope is written from what is there.",
    findingsBecome: "scope lines",
  },
  punch_walk: {
    key: "punch_walk",
    label: "Punch Walk",
    titleWord: "Punch walk",
    phase: "punch",
    purpose: "Walk the finished work and list what still has to be put right.",
    findingsBecome: "the punch list",
  },
};
