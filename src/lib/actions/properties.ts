"use server";

import { revalidatePath } from "next/cache";
import { eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { dedupeSlug, slugify } from "@/lib/slug";

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
});

export async function createProperty(
  formData: FormData,
): Promise<ActionResult<{ propertyId: number; slug: string }>> {
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

  const slug = await uniquePropertySlug(parsed.data.name);
  const [property] = await db()
    .insert(schema.properties)
    .values({ ...parsed.data, slug })
    .returning();

  revalidatePath("/");
  return { ok: true, propertyId: property.id, slug: property.slug };
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

