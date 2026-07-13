"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { PROJECT_STAGES } from "@/lib/stages";
import type { ActionResult } from "@/lib/action-result";

const createProjectSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  kind: z.enum(["unit", "common"]),
  name: z.string().trim().min(1).optional(),
  costCodeId: z.coerce.number().int().positive().optional(),
  unitNumber: z.string().trim().min(1).optional(),
  budgetAmount: z.coerce.number().nonnegative().optional(),
  startDate: z.string().trim().optional(),
});

export async function createProject(formData: FormData): Promise<ActionResult<{ projectId: number }>> {
  const parsed = createProjectSchema.parse({
    propertyId: formData.get("propertyId"),
    kind: formData.get("kind"),
    name: formData.get("name") || undefined,
    costCodeId: formData.get("costCodeId") || undefined,
    unitNumber: formData.get("unitNumber") || undefined,
    budgetAmount: formData.get("budgetAmount") || undefined,
    startDate: formData.get("startDate") || undefined,
  });

  let unitId: number | undefined;
  let name = parsed.name;

  if (parsed.kind === "unit") {
    if (!parsed.unitNumber) return { ok: false, error: "Unit number is required for a unit project" };
    // Upsert the unit inventory row and link it
    const existing = await db().query.units.findFirst({
      where: and(
        eq(schema.units.propertyId, parsed.propertyId),
        eq(schema.units.unitNumber, parsed.unitNumber),
      ),
    });
    if (existing) {
      unitId = existing.id;
    } else {
      const [unit] = await db()
        .insert(schema.units)
        .values({ propertyId: parsed.propertyId, unitNumber: parsed.unitNumber })
        .returning();
      unitId = unit.id;
    }
    name ??= `Unit ${parsed.unitNumber} Interior`;
  } else {
    if (!parsed.costCodeId) return { ok: false, error: "Cost code is required for a common project" };
    if (!name) {
      const code = await db().query.costCodes.findFirst({
        where: eq(schema.costCodes.id, parsed.costCodeId),
      });
      name = code?.name ?? "Project";
    }
  }

  const [project] = await db()
    .insert(schema.projects)
    .values({
      propertyId: parsed.propertyId,
      kind: parsed.kind,
      name: name!,
      costCodeId: parsed.kind === "common" ? parsed.costCodeId : undefined,
      unitId,
      budgetAmount: (parsed.budgetAmount ?? 0).toFixed(2),
      startDate: parsed.startDate || undefined,
    })
    .returning();

  await db().insert(schema.projectStageEvents).values({
    projectId: project.id,
    toStage: "planned",
    note: "Project created",
  });

  revalidatePath(`/properties/${parsed.propertyId}`);
  return { ok: true, projectId: project.id };
}

const stageKeys = PROJECT_STAGES.map((s) => s.key) as [string, ...string[]];

const setStageSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  toStage: z.enum(stageKeys),
  note: z.string().trim().optional(),
});

export async function setProjectStage(formData: FormData): Promise<ActionResult> {
  const parsed = setStageSchema.parse({
    projectId: formData.get("projectId"),
    toStage: formData.get("toStage"),
    note: formData.get("note") || undefined,
  });

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, parsed.projectId),
  });
  if (!project) return { ok: false, error: "Project not found" };
  if (project.stage === parsed.toStage) return { ok: true };

  const toStage = parsed.toStage as typeof project.stage;

  await db()
    .update(schema.projects)
    .set({
      stage: toStage,
      // Stage timestamps drive days-to-complete analytics.
      // toLocaleDateString("en-CA") = YYYY-MM-DD in server-local time, not UTC.
      ...(toStage === "in_progress" && !project.startDate
        ? { startDate: new Date().toLocaleDateString("en-CA") }
        : {}),
      ...(toStage === "complete" && !project.completeDate
        ? { completeDate: new Date().toLocaleDateString("en-CA") }
        : {}),
    })
    .where(eq(schema.projects.id, parsed.projectId));

  await db().insert(schema.projectStageEvents).values({
    projectId: parsed.projectId,
    fromStage: project.stage,
    toStage,
    note: parsed.note,
  });

  revalidatePath(`/properties/${project.propertyId}`);
  revalidatePath(`/properties/${project.propertyId}/projects/${project.id}`);
  revalidatePath("/");
  return { ok: true };
}
