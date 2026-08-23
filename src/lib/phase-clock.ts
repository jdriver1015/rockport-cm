import { asc, and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

// ---------------------------------------------------------------------------
// How long this project has been where it is.
//
// Reads project_stage_events, which is what setProjectPhase writes on every
// phase change. Not the milestone row: that is stamped by hand and often blank,
// which is exactly the gap these numbers exist to expose — a unit that reached
// Complete with three blank phases still has a real entry time here.
//
// Queried here rather than taken from the page's log, so this does not depend
// on which log that page happens to be reading.
// ---------------------------------------------------------------------------

export type PhaseClock = {
  /** When the project last entered the phase it is in now. */
  phaseEnteredAt: Date | null;
  /** The first recorded move on this project — the start of the turn. */
  startedAt: Date | null;
};

export async function readPhaseClock(projectId: number, phase: string): Promise<PhaseClock> {
  const [entered, first] = await Promise.all([
    db().query.projectStageEvents.findFirst({
      where: and(
        eq(schema.projectStageEvents.projectId, projectId),
        eq(schema.projectStageEvents.toPhase, phase as never),
      ),
      // Last time it entered, not the first: a phase can be reopened, and the
      // question is how long it has been sitting there now.
      orderBy: desc(schema.projectStageEvents.createdAt),
      columns: { createdAt: true },
    }),
    db().query.projectStageEvents.findFirst({
      where: eq(schema.projectStageEvents.projectId, projectId),
      orderBy: asc(schema.projectStageEvents.createdAt),
      columns: { createdAt: true },
    }),
  ]);

  return {
    phaseEnteredAt: entered?.createdAt ?? null,
    startedAt: first?.createdAt ?? null,
  };
}
