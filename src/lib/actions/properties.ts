"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";

const createPropertySchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  chartOfAccountsId: z.coerce.number().int().positive({ message: "Pick a chart of accounts" }),
  entity: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  unitCount: z.coerce.number().int().positive().optional(),
  pmSystem: z.string().trim().optional(),
});

export async function createProperty(formData: FormData): Promise<ActionResult<{ propertyId: number }>> {
  const parsed = createPropertySchema.safeParse({
    name: formData.get("name"),
    chartOfAccountsId: formData.get("chartOfAccountsId"),
    entity: formData.get("entity") || undefined,
    city: formData.get("city") || undefined,
    state: formData.get("state") || undefined,
    unitCount: formData.get("unitCount") || undefined,
    pmSystem: formData.get("pmSystem") || undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  // Guard against a stale/invalid chart id from the client.
  const chart = await db().query.chartsOfAccounts.findFirst({
    where: eq(schema.chartsOfAccounts.id, parsed.data.chartOfAccountsId),
  });
  if (!chart) return { ok: false, error: "Selected chart of accounts no longer exists" };

  const [property] = await db().insert(schema.properties).values(parsed.data).returning();

  revalidatePath("/");
  return { ok: true, propertyId: property.id };
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

/** Edit a property's basic fields. Chart of accounts is changed separately via updatePropertyChart. */
export async function updateProperty(formData: FormData): Promise<ActionResult> {
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

  await db()
    .update(schema.properties)
    .set({
      name: rest.name,
      entity: rest.entity ?? null,
      city: rest.city ?? null,
      state: rest.state ?? null,
      unitCount: rest.unitCount ?? null,
      pmSystem: rest.pmSystem ?? null,
    })
    .where(eq(schema.properties.id, id));

  revalidatePath(`/properties/${id}`);
  revalidatePath("/");
  return { ok: true };
}

/**
 * Count GL rows (any status — staged rows already reference codes) for a property.
 * Non-zero locks the chart, since switching would orphan those transactions.
 */
export async function propertyGlActivityCount(propertyId: number): Promise<number> {
  const [{ count }] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.glTransactions)
    .where(eq(schema.glTransactions.propertyId, propertyId));
  return count;
}

/**
 * Switch a property to a different chart of accounts. Blocked once the property
 * has any GL activity (the integrity gate). With no GL, the switch is allowed
 * but budget lines coded to the old chart are removed and projects are unlinked
 * from their old cost codes — both must be re-coded against the new chart.
 */
export async function updatePropertyChart(input: {
  propertyId: number;
  chartOfAccountsId: number;
}): Promise<ActionResult<{ clearedBudgetLines: number; unlinkedProjects: number }>> {
  const propertyId = Number(input.propertyId);
  const chartId = Number(input.chartOfAccountsId);
  if (!Number.isInteger(propertyId) || !Number.isInteger(chartId)) {
    return { ok: false, error: "Invalid input" };
  }

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
  });
  if (!property) return { ok: false, error: "Property not found" };

  if (property.chartOfAccountsId === chartId) {
    return { ok: true, clearedBudgetLines: 0, unlinkedProjects: 0 };
  }

  const chart = await db().query.chartsOfAccounts.findFirst({
    where: eq(schema.chartsOfAccounts.id, chartId),
  });
  if (!chart || chart.archivedAt) return { ok: false, error: "Selected chart is unavailable" };

  const glCount = await propertyGlActivityCount(propertyId);
  if (glCount > 0) {
    return {
      ok: false,
      error: `Chart is locked — ${glCount} GL transaction${glCount === 1 ? "" : "s"} reference its codes. Delete all GL activity for this property first.`,
    };
  }

  const result = await db().transaction(async (tx) => {
    const cleared = await tx
      .delete(schema.budgetLines)
      .where(eq(schema.budgetLines.propertyId, propertyId))
      .returning({ id: schema.budgetLines.id });

    const unlinked = await tx
      .update(schema.projects)
      .set({ costCodeId: null })
      .where(and(eq(schema.projects.propertyId, propertyId), sql`${schema.projects.costCodeId} is not null`))
      .returning({ id: schema.projects.id });

    await tx
      .update(schema.properties)
      .set({ chartOfAccountsId: chartId })
      .where(eq(schema.properties.id, propertyId));

    return { clearedBudgetLines: cleared.length, unlinkedProjects: unlinked.length };
  });

  revalidatePath(`/properties/${propertyId}`);
  revalidatePath(`/properties/${propertyId}/budget`);
  revalidatePath(`/properties/${propertyId}/projects`);
  revalidatePath("/");
  return { ok: true, ...result };
}
