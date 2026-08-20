import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// ---------------------------------------------------------------------------
// Reads over the portfolio interior defaults, and the one write that belongs to
// property creation rather than to a user gesture. Kept out of the actions file
// so the seed step is a function createProperty calls, not an endpoint of its
// own.
// ---------------------------------------------------------------------------

/** The singleton's fixed primary key. See the CHECK on the table. */
export const DEFAULTS_ID = 1;

export type InteriorDefaults = {
  cmPct: number;
  contingencyPct: number;
  cmEnabled: boolean;
  contingencyEnabled: boolean;
  /** Cost CODE, not id — a default outlives any one chart of accounts. */
  cmCostCodeRef: string | null;
  contingencyCostCodeRef: string | null;
};
/**
 * Read the portfolio defaults, creating nothing. Absent row reads as the
 * column defaults, so a fresh database behaves like an untouched one rather
 * than failing.
 */
export async function readInteriorDefaults(): Promise<InteriorDefaults> {
  const row = await db().query.interiorDefaultSettings.findFirst({
    where: eq(schema.interiorDefaultSettings.id, DEFAULTS_ID),
  });
  return {
    cmPct: row ? Number(row.cmSupervisionPct) : 0,
    contingencyPct: row ? Number(row.contingencyPct) : 0,
    cmEnabled: row?.cmEnabled ?? true,
    contingencyEnabled: row?.contingencyEnabled ?? true,
    cmCostCodeRef: row?.cmCostCodeRef ?? null,
    contingencyCostCodeRef: row?.contingencyCostCodeRef ?? null,
  };
}

/**
 * Which renovation types a new property should arrive pre-checked with, plus
 * the rest of the list for the checklist to offer.
 */
export async function listSeedableTemplates(): Promise<
  { id: number; name: string; description: string | null; seedByDefault: boolean; lineCount: number }[]
> {
  const [templates, counts] = await Promise.all([
    db()
      .select({
        id: schema.budgetTemplates.id,
        name: schema.budgetTemplates.name,
        description: schema.budgetTemplates.description,
        seedByDefault: schema.budgetTemplates.seedByDefault,
      })
      .from(schema.budgetTemplates)
      .where(
        and(eq(schema.budgetTemplates.active, true), isNull(schema.budgetTemplates.archivedAt)),
      )
      .orderBy(asc(schema.budgetTemplates.sortOrder), asc(schema.budgetTemplates.name)),
    db()
      .select({
        templateId: schema.budgetTemplateLines.templateId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.budgetTemplateLines)
      .groupBy(schema.budgetTemplateLines.templateId),
  ]);

  const byTemplate = new Map(counts.map((c) => [c.templateId, c.count]));
  return templates.map((t) => ({ ...t, lineCount: byTemplate.get(t.id) ?? 0 }));
}

/**
 * Seed one new property's interior uplift settings from the portfolio defaults,
 * resolving the stored cost-code refs against the chart it was created with.
 *
 * Returns the refs that had no match so the caller can say so: a missing ref
 * leaves that uplift unattributed, which is exactly the silent failure the
 * per-property guard exists to prevent.
 */
export async function seedInteriorSettingsFromDefaults(
  propertyId: number,
  chartId: number,
): Promise<{ unresolvedRefs: string[] }> {
  const defaults = await readInteriorDefaults();

  const wanted = [defaults.cmCostCodeRef, defaults.contingencyCostCodeRef].filter(
    (r): r is string => !!r,
  );
  const codeMap = new Map<string, number>();
  if (wanted.length > 0) {
    const rows = await db()
      .select({ id: schema.costCodes.id, code: schema.costCodes.code })
      .from(schema.costCodes)
      .where(
        and(eq(schema.costCodes.chartId, chartId), inArray(schema.costCodes.code, [...new Set(wanted)])),
      );
    for (const r of rows) codeMap.set(r.code, r.id);
  }

  const unresolvedRefs = wanted.filter((r) => !codeMap.has(r));

  await db()
    .insert(schema.interiorBudgetSettings)
    .values({
      propertyId,
      cmSupervisionPct: defaults.cmPct.toFixed(3),
      contingencyPct: defaults.contingencyPct.toFixed(3),
      cmEnabled: defaults.cmEnabled,
      contingencyEnabled: defaults.contingencyEnabled,
      cmCostCodeId: defaults.cmCostCodeRef ? codeMap.get(defaults.cmCostCodeRef) ?? null : null,
      contingencyCostCodeId: defaults.contingencyCostCodeRef
        ? codeMap.get(defaults.contingencyCostCodeRef) ?? null
        : null,
    })
    .onConflictDoNothing({ target: schema.interiorBudgetSettings.propertyId });

  return { unresolvedRefs };
}
