"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { PROJECT_PHASES } from "@/lib/stages";
import type { ActionResult } from "@/lib/action-result";

const phaseKeys = PROJECT_PHASES.map((p) => p.key) as [string, ...string[]];

const optDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null));

const createSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  label: z.string().trim().min(1, "Label is required"),
  phase: z.enum(phaseKeys).optional().transform((v) => v ?? null),
  plannedDate: optDate,
  actualDate: optDate,
  sortOrder: z.coerce.number().int().default(0),
});

export async function createMilestone(formData: FormData): Promise<ActionResult<{ milestoneId: number }>> {
  const parsed = createSchema.parse({
    projectId: formData.get("projectId"),
    label: formData.get("label"),
    phase: formData.get("phase") || undefined,
    plannedDate: formData.get("plannedDate") || undefined,
    actualDate: formData.get("actualDate") || undefined,
    sortOrder: formData.get("sortOrder") ?? 0,
  });

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, parsed.projectId),
  });
  if (!project) return { ok: false, error: "Project not found" };

  const [ms] = await db()
    .insert(schema.projectMilestones)
    .values({
      projectId: parsed.projectId,
      label: parsed.label,
      phase: parsed.phase as typeof project.phase | null,
      plannedDate: parsed.plannedDate,
      actualDate: parsed.actualDate,
      sortOrder: parsed.sortOrder,
    })
    .returning({ id: schema.projectMilestones.id });

  revalidatePath(`/properties/${project.propertyId}/projects/${project.id}`);
  return { ok: true, milestoneId: ms.id };
}

const updateSchema = z.object({
  milestoneId: z.coerce.number().int().positive(),
  label: z.string().trim().min(1, "Label is required").optional(),
  phase: z.enum(phaseKeys).optional().transform((v) => v ?? null),
  plannedDate: optDate,
  actualDate: optDate,
  sortOrder: z.coerce.number().int().optional(),
});

export async function updateMilestone(formData: FormData): Promise<ActionResult> {
  const parsed = updateSchema.parse({
    milestoneId: formData.get("milestoneId"),
    label: formData.get("label") || undefined,
    phase: formData.get("phase") || undefined,
    plannedDate: formData.get("plannedDate"),
    actualDate: formData.get("actualDate"),
    sortOrder: formData.get("sortOrder") ?? undefined,
  });

  const milestone = await db().query.projectMilestones.findFirst({
    where: eq(schema.projectMilestones.id, parsed.milestoneId),
  });
  if (!milestone) return { ok: false, error: "Milestone not found" };

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, milestone.projectId),
  });
  if (!project) return { ok: false, error: "Project not found" };

  await db()
    .update(schema.projectMilestones)
    .set({
      ...(parsed.label != null ? { label: parsed.label } : {}),
      phase: parsed.phase as typeof project.phase | null,
      plannedDate: parsed.plannedDate,
      actualDate: parsed.actualDate,
      ...(parsed.sortOrder != null ? { sortOrder: parsed.sortOrder } : {}),
    })
    .where(eq(schema.projectMilestones.id, parsed.milestoneId));

  revalidatePath(`/properties/${project.propertyId}/projects/${project.id}`);
  return { ok: true };
}

export async function archiveMilestone(formData: FormData): Promise<ActionResult> {
  const milestoneId = z.coerce.number().int().positive().parse(formData.get("milestoneId"));

  const milestone = await db().query.projectMilestones.findFirst({
    where: eq(schema.projectMilestones.id, milestoneId),
  });
  if (!milestone) return { ok: false, error: "Milestone not found" };

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, milestone.projectId),
  });
  if (!project) return { ok: false, error: "Project not found" };

  await db()
    .update(schema.projectMilestones)
    .set({ archivedAt: new Date() })
    .where(eq(schema.projectMilestones.id, milestoneId));

  revalidatePath(`/properties/${project.propertyId}/projects/${project.id}`);
  return { ok: true };
}
