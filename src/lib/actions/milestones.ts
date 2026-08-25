"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { PROJECT_PHASES } from "@/lib/stages";
import { requireUser } from "@/lib/auth";
import type { ActionResult } from "@/lib/action-result";
import { propertyPath } from "@/lib/property-path";
import { FIRST_CUSTOM_SORT_ORDER } from "@/lib/milestones";
import { projectSlug } from "@/lib/slug";
import { logFieldChange, logFieldChanges } from "@/lib/actions/activity-log";
import { fmtDate } from "@/lib/format";

const phaseKeys = PROJECT_PHASES.map((p) => p.key) as [string, ...string[]];

async function revalidateProject(propertyId: number, project: { id: number; name: string }) {
  const path = await propertyPath(propertyId, `/projects/${projectSlug(project)}`);
  if (path) revalidatePath(path);
}

const optDate = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null));

const optText = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null));

const createSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  label: z.string().trim().min(1, "Label is required"),
  phase: z.enum(phaseKeys).nullish(),
  plannedDate: optDate,
  actualDate: optDate,
  note: optText,
  sortOrder: z.coerce.number().int().default(0),
});

export async function createMilestone(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<{ id: number }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const project = await db().query.projects.findFirst({ where: eq(schema.projects.id, d.projectId) });
  if (!project) return { ok: false, error: "Project not found" };

  // Customs land after the four defaults instead of colliding with Pre-Con at
  // sortOrder 0, which left their position among the defaults arbitrary.
  const [{ maxOrder }] = await db()
    .select({
      maxOrder: sql<number>`coalesce(max(${schema.projectMilestones.sortOrder}), ${FIRST_CUSTOM_SORT_ORDER - 1})::int`,
    })
    .from(schema.projectMilestones)
    .where(
      and(
        eq(schema.projectMilestones.projectId, d.projectId),
        isNull(schema.projectMilestones.archivedAt),
      ),
    );

  const [ms] = await db()
    .insert(schema.projectMilestones)
    .values({
      projectId: d.projectId,
      label: d.label,
      phase: (d.phase ?? null) as typeof project.phase | null,
      plannedDate: d.plannedDate,
      actualDate: d.actualDate,
      note: d.note,
      sortOrder: maxOrder + 1,
    })
    .returning({ id: schema.projectMilestones.id });

  await logFieldChange({
    projectId: d.projectId,
    userId: auth.profile.id,
    field: "milestone",
    fieldLabel: `Milestone: ${d.label}`,
    from: null,
    to: d.plannedDate ? `Added (planned ${fmtDate(d.plannedDate)})` : "Added",
  });

  await revalidateProject(project.propertyId, project);
  return { ok: true, id: ms.id };
}

const updateSchema = z.object({
  id: z.coerce.number().int().positive(),
  label: z.string().trim().min(1, "Label is required").optional(),
  plannedDate: optDate,
  actualDate: optDate,
  note: optText,
});

export async function updateMilestone(input: z.input<typeof updateSchema>): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const milestone = await db().query.projectMilestones.findFirst({
    where: eq(schema.projectMilestones.id, d.id),
  });
  if (!milestone) return { ok: false, error: "Milestone not found" };

  const project = await db().query.projects.findFirst({ where: eq(schema.projects.id, milestone.projectId) });
  if (!project) return { ok: false, error: "Project not found" };

  const set: Partial<typeof schema.projectMilestones.$inferInsert> = {};
  if (d.label !== undefined) {
    // The four defaults are fixed wording so every project reads the same; only
    // their dates and notes are editable.
    if (milestone.isDefault && d.label !== milestone.label) {
      return { ok: false, error: `"${milestone.label}" is a default milestone and cannot be renamed` };
    }
    set.label = d.label;
  }
  if (input.plannedDate !== undefined) set.plannedDate = d.plannedDate;
  if (input.actualDate !== undefined) set.actualDate = d.actualDate;
  if (input.note !== undefined) set.note = d.note;

  if (Object.keys(set).length > 0) {
    await db().update(schema.projectMilestones).set(set).where(eq(schema.projectMilestones.id, d.id));
  }

  // Label stays fixed on defaults (guarded above), so it never needs logging there.
  const label = set.label ?? milestone.label;
  await logFieldChanges({
    projectId: milestone.projectId,
    userId: auth.profile.id,
    changes: [
      ...(set.label !== undefined
        ? [{ field: "milestone:label", fieldLabel: `Milestone: ${milestone.label} → Label`, from: milestone.label, to: set.label }]
        : []),
      ...(input.plannedDate !== undefined
        ? [{ field: "milestone:plannedDate", fieldLabel: `${label}: Planned Date`, from: fmtDate(milestone.plannedDate), to: fmtDate(d.plannedDate) }]
        : []),
      ...(input.actualDate !== undefined
        ? [{ field: "milestone:actualDate", fieldLabel: `${label}: Actual Date`, from: fmtDate(milestone.actualDate), to: fmtDate(d.actualDate) }]
        : []),
      ...(input.note !== undefined
        ? [{ field: "milestone:note", fieldLabel: `${label}: Note`, from: milestone.note, to: d.note }]
        : []),
    ],
  });

  await revalidateProject(project.propertyId, project);
  return { ok: true };
}

export async function archiveMilestone(input: { id: number }): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const milestone = await db().query.projectMilestones.findFirst({
    where: eq(schema.projectMilestones.id, input.id),
  });
  if (!milestone) return { ok: false, error: "Milestone not found" };

  const project = await db().query.projects.findFirst({ where: eq(schema.projects.id, milestone.projectId) });
  if (!project) return { ok: false, error: "Project not found" };

  // Enforced here, not just hidden in the UI — the action is directly callable,
  // and losing a default silently stops its phase being recorded.
  if (milestone.isDefault) {
    return { ok: false, error: `"${milestone.label}" is a default milestone and cannot be deleted` };
  }

  await db()
    .update(schema.projectMilestones)
    .set({ archivedAt: new Date() })
    .where(eq(schema.projectMilestones.id, input.id));

  await logFieldChange({
    projectId: milestone.projectId,
    userId: auth.profile.id,
    field: "milestone",
    fieldLabel: `Milestone: ${milestone.label}`,
    from: "Active",
    to: "Archived",
  });

  await revalidateProject(project.propertyId, project);
  return { ok: true };
}
