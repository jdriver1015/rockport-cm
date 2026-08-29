import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { defaultMilestoneRows } from "@/lib/milestones";
import { recomputeProjectBudget } from "@/lib/project-budget-derive";
import { projectSlug } from "@/lib/slug";import type { ActionResult } from "@/lib/action-result";

// ---------------------------------------------------------------------------
// Creating a common-area project.
//
// The old form asked for one thing: a name. Everything else — the cost code it
// draws from, its scope, its budget, its schedule — had to be filled in
// afterwards from four different screens, so every common project began as an
// empty shell and stayed one until somebody remembered.
//
// Notably absent here: a budget field. A project's budget is what its scope
// adds up to (see project-budget-derive.ts), and asking for a total as well
// would put the same number in two places — the mistake this codebase has now
// made and unmade three times. The scope produces it.
// ---------------------------------------------------------------------------

const optDate = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const lineSchema = z.object({
  item: z.string().trim().min(1, "Every scope line needs a description"),
  costCodeId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().nonnegative(),
  unitPrice: z.coerce.number().nonnegative(),
  notes: z.string().trim().optional().nullable(),
});

const createSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Give the project a name"),
  /**
   * The UW line this project spends against. Legitimately project-level here:
   * a common-area job draws on one budget line, unlike an interior turn that
   * spends across every 4000-series code and therefore carries none.
   */
  costCodeId: z.coerce.number().int().positive(),
  notes: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  /** Target phasing — the day each phase is planned to BEGIN, keyed by phase. */
  milestones: z
    .array(z.object({ phase: z.string().trim().min(1), plannedDate: optDate }))
    .optional(),
  lines: z.array(lineSchema).default([]),
});

export type CreateCommonProjectInput = z.input<typeof createSchema>;

/**
 * The whole creation, minus the request-scoped parts.
 *
 * Split the way scope-confirm and bid-package are split: the action does auth
 * and revalidation, this does the work. It is the only shape a probe can drive,
 * because requireUser reads cookies and there are none outside a request.
 */
export async function createCommonProjectRows(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ projectId: number; slug: string; propertySlug: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, d.propertyId),
  });
  if (!property) return { ok: false, error: "Property not found" };

  // Every code — the project's own and each line's — has to belong to this
  // property's chart. A code from another chart would post against a ledger
  // this property does not use.
  const codeIds = [...new Set([d.costCodeId, ...d.lines.map((l) => l.costCodeId)])];
  const valid = await db()
    .select({ id: schema.costCodes.id })
    .from(schema.costCodes)
    .where(
      and(
        eq(schema.costCodes.chartId, property.chartOfAccountsId),
        inArray(schema.costCodes.id, codeIds),
      ),
    );
  if (valid.length !== codeIds.length) {
    return { ok: false, error: "A cost code does not belong to this property's chart" };
  }

  const result = await db().transaction(async (tx) => {
    const [project] = await tx
      .insert(schema.projects)
      .values({
        propertyId: d.propertyId,
        kind: "common",
        name: d.name,
        costCodeId: d.costCodeId,
        notes: d.notes,
        // No budgetAmount and no startDate. The first is derived from the scope
        // below; the second records what actually happened and is stamped on
        // entry to In Process.
      })
      .returning({ id: schema.projects.id, name: schema.projects.name });

    if (d.lines.length > 0) {
      await tx.insert(schema.scopeItems).values(
        d.lines.map((l, i) => ({
          projectId: project.id,
          item: l.item,
          costCodeId: l.costCodeId,
          quantity: l.quantity.toFixed(2),
          unitPrice: l.unitPrice.toFixed(2),
          materialQuality: l.notes ?? null,
          sortOrder: i,
        })),
      );
    }

    await tx.insert(schema.projectStageEvents).values({
      projectId: project.id,
      toStage: "planned",
      toPhase: "precon",
      note: "Created from the common-area wizard",
    });

    // The four phases, carrying whatever target phasing the wizard collected. A
    // phase the caller left blank stays undated rather than being guessed at
    // here, so the suggestion lives in exactly one place.
    const plannedByPhase = new Map((d.milestones ?? []).map((m) => [m.phase, m.plannedDate]));
    await tx.insert(schema.projectMilestones).values(
      defaultMilestoneRows(project.id).map((row) => ({
        ...row,
        plannedDate: plannedByPhase.get(row.phase) ?? null,
      })),
    );

    return project;
  });

  // Outside the transaction: it reads the rows just written and only ever
  // narrows the budget to what the scope says.
  await recomputeProjectBudget(result.id);

  return {
    ok: true,
    projectId: result.id,
    slug: projectSlug(result),
    propertySlug: property.slug,
  };
}
