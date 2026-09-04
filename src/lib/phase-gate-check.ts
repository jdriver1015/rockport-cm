import { evaluateGates } from "@/lib/phase-gates";
import { readGateStates } from "@/lib/precon-gate-state";
import { phaseIndex, phaseLabel, type ProjectPhaseKey } from "@/lib/stages";

/**
 * Server-side enforcement of the phase gates.
 *
 * The checks live in phase-gates.ts and are shown inline on the project's phases
 * section and now as the board's Next Step button, but showing them is not
 * enforcing them: the phase can be changed from the header dropdown, from the
 * board, and from anywhere else that calls setProjectPhase. Checking here covers
 * every path with one call.
 *
 * The start milestone, the open findings and the posted GL total used to be
 * three queries written out here, duplicating what readGateStates already reads
 * for the same project. They are gone — this file is now the rule, not the
 * plumbing.
 */

export type GateVerdict = { ok: true } | { ok: false; error: string };

/**
 * Whether the move is a forward one. Only forward moves are gated: correcting a
 * project back to an earlier phase has to stay possible, or a wrong click
 * becomes unfixable.
 */
function isForward(from: string, to: string): boolean {
  const f = phaseIndex(from);
  const t = phaseIndex(to);
  return f !== -1 && t !== -1 && t > f;
}

export async function checkPhaseAdvance(
  projectId: number,
  fromPhase: string,
  toPhase: string,
): Promise<GateVerdict> {
  if (!isForward(fromPhase, toPhase)) return { ok: true };

  const states = await readGateStates([projectId]);
  const state = states.get(projectId);
  // No such project. Nothing to advance, and refusing is the safe answer.
  if (!state) return { ok: false, error: "Project not found" };

  const result = evaluateGates(fromPhase as ProjectPhaseKey, toPhase as ProjectPhaseKey, state);

  if (result.allMet) return { ok: true };

  // Names the outstanding checks with their detail, so the refusal says what to
  // go and do rather than only that it said no.
  const unmet = result.checks
    .filter((c) => !c.met)
    .map((c) => `${c.label} (${c.detail})`)
    .join(", ");
  return {
    ok: false,
    error: `Can't advance to ${phaseLabel(toPhase)} yet — ${unmet}.`,
  };
}
