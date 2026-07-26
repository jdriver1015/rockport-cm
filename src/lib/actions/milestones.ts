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
  const parsed = createSchema.safeParse({
    projectId: formData.get("projectId"),
    label: formData.get("label"),
    phase: formData.get("phase") || undefined,
    plannedDate: formData.get("plannedDate") || undefined,
    actualDate: formData.get("actualDate") || undefined,
    sortOrder: formData.get("sortOrder") ?? 0,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, d.projectId),
  });
  if (!project) return { ok: false, error: "Project not found" };

  const [ms] = await db()
    .insert(schema.projectMilestones)
    .values({
      projectId: d.projectId,
      label: d.label,
      phase: d.phase as typeof project.phase | null,
      plannedDate: d.plannedDate,
      actualDate: d.actualDate,
      sortOrder: d.sortOrder,
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
  const parsed = updateSchema.safeParse({
    milestoneId: formData.get("milestoneId"),
    label: formData.get("label") || undefined,
    phase: formData.get("phase") || undefined,
    plannedDate: formData.get("plannedDate"),
    actualDate: formData.get("actualDate"),
    sortOrder: formData.get("sortOrder") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const milestone = await db().query.projectMilestones.findFirst({
    where: eq(schema.projectMilestones.id, d.milestoneId),
  });
  if (!milestone) return { ok: false, error: "Milestone not found" };

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, milestone.projectId),
  });
  if (!project) return { ok: false, error: "Project not found" };

  await db()
    .update(schema.projectMilestones)
    .set({
      ...(d.label != null ? { label: d.label } : {}),
      phase: d.phase as typeof project.phase | null,
      plannedDate: d.plannedDate,
      actualDate: d.actualDate,
      ...(d.sortOrder != null ? { sortOrder: d.sortOrder } : {}),
    })
    .where(eq(schema.projectMilestones.id, d.milestoneId));

  revalidatePath(`/properties/${project.propertyId}/projects/${project.id}`);
  return { ok: true };
}

export async function archiveMilestone(formData: FormData): Promise<ActionResult> {
  const parsed = z.object({ milestoneId: z.coerce.number().int().positive() }).safeParse({
    milestoneId: formData.get("milestoneId"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid milestone" };

  const milestone = await db().query.projectMilestones.findFirst({
    where: eq(schema.projectMilestones.id, parsed.data.milestoneId),
  });
  if (!milestone) return { ok: false, error: "Milestone not found" };

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, milestone.projectId),
  });
  if (!project) return { ok: false, error: "Project not found" };

  await db()
    .update(schema.projectMilestones)
    .set({ archivedAt: new Date() })
    .where(eq(schema.projectMilestones.id, parsed.data.milestoneId));

  revalidatePath(`/properties/${project.propertyId}/projects/${project.id}`);
  return { ok: true };
}
