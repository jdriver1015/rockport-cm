"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { dedupeSlug, slugify } from "@/lib/slug";
import { seedInteriorSettingsFromDefaults } from "@/lib/interior-defaults";
import { createGroupFromTemplate } from "@/lib/actions/budget-groups";
import { applyBudgetImport } from "@/lib/property-budget-import";

/** A unique property slug for `name`, excluding `excludeId` (used on rename). */
async function uniquePropertySlug(name: string, excludeId?: number): Promise<string> {
  const existing = await db()
    .select({ slug: schema.properties.slug })
    .from(schema.properties)
    .where(excludeId != null ? ne(schema.properties.id, excludeId) : undefined);
  return dedupeSlug(slugify(name), new Set(existing.map((r) => r.slug)));
}

const createPropertySchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  chartOfAccountsId: z.coerce.number().int().positive({ message: "Pick a chart of accounts" }),
  entity: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  unitCount: z.coerce.number().int().positive().optional(),
  pmSystem: z.string().trim().optional(),
  /**
   * Renovation types to seed, chosen from a checklist at creation. Deliberately
   * a choice rather than "seed everything active": the portfolio has seven
   * types and no property uses all of them, so seeding all would leave every
   * new property with types to archive before it could be read.
   */
  seedTemplateIds: z.array(z.coerce.number().int().positive()).default([]),
  /**
   * The budget lines a BudgetImportDialog(mode="prepare") already resolved
   * against this chart, as JSON — `{costCodeId, uwAmount}[]`. Resolved before
   * the property exists (matching against a chart needs no property row), and
   * applied here, in the same non-fatal pass as everything else, once it does.
   */
  budgetImportRows: z.string().optional(),
});

export async function createProperty(
  formData: FormData,
): Promise<
  ActionResult<{
    propertyId: number;
    slug: string;
    seededTypes: number;
    budgetLinesSeeded: number;
    /** Non-fatal shortfalls worth telling the user about. */
    notes: string[];
  }>
> {
  const parsed = createPropertySchema.safeParse({
    name: formData.get("name"),
    chartOfAccountsId: formData.get("chartOfAccountsId"),
    entity: formData.get("entity") || undefined,
    city: formData.get("city") || undefined,
    state: formData.get("state") || undefined,
    unitCount: formData.get("unitCount") || undefined,
    pmSystem: formData.get("pmSystem") || undefined,
    seedTemplateIds: formData.getAll("seedTemplateIds"),
    budgetImportRows: formData.get("budgetImportRows") || undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  // Guard against a stale/invalid chart id from the client.
  const chart = await db().query.chartsOfAccounts.findFirst({
    where: eq(schema.chartsOfAccounts.id, parsed.data.chartOfAccountsId),
  });
  if (!chart) return { ok: false, error: "Selected chart of accounts no longer exists" };

  const { seedTemplateIds, budgetImportRows: budgetImportRowsRaw, ...fields } = parsed.data;

  // Parsed and validated before the insert, so a malformed payload is refused
  // up front rather than discovered as a silent no-op after the property is
  // already real.
  let budgetImportRows: { costCodeId: number; uwAmount: number }[] = [];
  if (budgetImportRowsRaw) {
    try {
      const raw = JSON.parse(budgetImportRowsRaw);
      if (
        Array.isArray(raw) &&
        raw.every(
          (r) =>
            r && typeof r.costCodeId === "number" && Number.isInteger(r.costCodeId) &&
            typeof r.uwAmount === "number" && Number.isFinite(r.uwAmount) && r.uwAmount > 0,
        )
      ) {
        budgetImportRows = raw;
      }
    } catch {
      // Malformed JSON is treated the same as none supplied — the dialog that
      // produces this value is the only writer, so this only happens if
      // something upstream is broken, and the property should still be
      // creatable either way.
    }
  }
  const slug = await uniquePropertySlug(fields.name);
  const [property] = await db()
    .insert(schema.properties)
    .values({ ...fields, slug })
    .returning();

  // Seeding happens after the property exists and is deliberately not fatal:
  // the property is real either way, and failing the whole creation because one
  // renovation type's cost code is missing would be worse than saying so. Each
  // shortfall is reported instead, because both are silent otherwise — an
  // unattributed uplift stops the pivot reconciling to the Interiors division,
  // and a partially-copied type looks like a type that simply costs less.
  const notes: string[] = [];
  const { unresolvedRefs } = await seedInteriorSettingsFromDefaults(
    property.id,
    fields.chartOfAccountsId,
  );
  if (unresolvedRefs.length > 0) {
    notes.push(
      `uplift cost code${unresolvedRefs.length === 1 ? "" : "s"} ${unresolvedRefs.join(", ")} not in this chart`,
    );
  }

  let seededTypes = 0;
  let unresolvedLines = 0;
  for (const templateId of seedTemplateIds) {
    const res = await createGroupFromTemplate({ propertyId: property.id, templateId });
    if (!res.ok) {
      notes.push(res.error);
      continue;
    }
    seededTypes++;
    unresolvedLines += res.unresolved;
  }
  if (unresolvedLines > 0) {
    notes.push(`${unresolvedLines} priced line(s) had no matching cost code in this chart`);
  }

  let budgetLinesSeeded = 0;
  if (budgetImportRows.length > 0) {
    // Re-validated against THIS chart rather than trusted from the client: the
    // dialog resolved these against the chart the person had selected at the
    // time, which is cheap to re-confirm and expensive to get wrong silently.
    const validCodes = await db()
      .select({ id: schema.costCodes.id })
      .from(schema.costCodes)
      .where(and(eq(schema.costCodes.chartId, fields.chartOfAccountsId), eq(schema.costCodes.active, true)));
    const validIds = new Set(validCodes.map((c) => c.id));
    const usable = budgetImportRows.filter((r) => validIds.has(r.costCodeId));
    if (usable.length > 0) {
      // Not fatal, like the seeding above: the property is real either way,
      // and a DB error partway through (e.g. an out-of-range amount) should
      // be reported, not left to throw uncaught and strand an unexplained
      // partially-seeded property.
      try {
        await applyBudgetImport(
          db(),
          property.id,
          usable.map((r) => ({
            costCodeId: r.costCodeId,
            code: "",
            name: "",
            categoryName: null,
            from: null,
            to: r.uwAmount,
          })),
        );
        budgetLinesSeeded = usable.length;
      } catch (err) {
        notes.push(
          `the uploaded budget could not be applied${err instanceof Error ? `: ${err.message}` : ""} — add lines manually from the Budget tab`,
        );
      }
    }
    if (usable.length < budgetImportRows.length) {
      notes.push(
        `${budgetImportRows.length - usable.length} budget line(s) from the file no longer match this chart`,
      );
    }
  }

  revalidatePath("/");
  return {
    ok: true,
    propertyId: property.id,
    slug: property.slug,
    seededTypes,
    budgetLinesSeeded,
    notes,
  };
}

const updatePropertySchema = z.object({
  id: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Name is required"),
  entity: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  unitCount: z.coerce.number().int().positive().optional(),
  pmSystem: z.string().trim().optional(),
});

/** Edit a property's basic fields. Chart of accounts is fixed at creation and cannot be changed. */
export async function updateProperty(formData: FormData): Promise<ActionResult<{ slug: string }>> {
  const parsed = updatePropertySchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    entity: formData.get("entity") || undefined,
    city: formData.get("city") || undefined,
    state: formData.get("state") || undefined,
    unitCount: formData.get("unitCount") || undefined,
    pmSystem: formData.get("pmSystem") || undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { id, ...rest } = parsed.data;

  const existing = await db().query.properties.findFirst({ where: eq(schema.properties.id, id) });
  if (!existing) return { ok: false, error: "Property not found" };

  // Renaming re-slugs the URL (old bookmarks to this property will 404).
  const slug = rest.name !== existing.name ? await uniquePropertySlug(rest.name, id) : existing.slug;

  await db()
    .update(schema.properties)
    .set({
      name: rest.name,
      slug,
      entity: rest.entity ?? null,
      city: rest.city ?? null,
      state: rest.state ?? null,
      unitCount: rest.unitCount ?? null,
      pmSystem: rest.pmSystem ?? null,
    })
    .where(eq(schema.properties.id, id));

  revalidatePath(`/properties/${slug}`);
  revalidatePath("/");
  return { ok: true, slug };
}

