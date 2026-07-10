"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";

const createPropertySchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  entity: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  unitCount: z.coerce.number().int().positive().optional(),
  pmSystem: z.string().trim().optional(),
});

export async function createProperty(formData: FormData) {
  const parsed = createPropertySchema.parse({
    name: formData.get("name"),
    entity: formData.get("entity") || undefined,
    city: formData.get("city") || undefined,
    state: formData.get("state") || undefined,
    unitCount: formData.get("unitCount") || undefined,
    pmSystem: formData.get("pmSystem") || undefined,
  });

  const [property] = await db().insert(schema.properties).values(parsed).returning();

  revalidatePath("/");
  redirect(`/properties/${property.id}`);
}
