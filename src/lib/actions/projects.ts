"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { PROJECT_PHASES } from "@/lib/stages";
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
    const code = await db().query.costCodes.findFirst({
      where: eq(schema.costCodes.id, parsed.costCodeId),
    });
    if (!code) return { ok: false, error: "Cost code not found" };
    // The code must belong to this property's chart of accounts.
    const property = await db().query.properties.findFirst({
      where: eq(schema.properties.id, parsed.propertyId),
      columns: { chartOfAccountsId: true },
    });
    if (!property) return { ok: false, error: "Property not found" };
    if (code.chartId !== property.chartOfAccountsId) {
      return { ok: false, error: "That cost code isn't in this property's chart of accounts" };
    }
    if (!name) name = code.name ?? "Project";
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
    toPhase: "precon",
    note: "Project created",
  });

  revalidatePath(`/properties/${parsed.propertyId}`);
  return { ok: true, projectId: project.id };
}

// Optional money/date fields come off the edit form as strings; "" means clear.
const optMoney = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || !Number.isNaN(Number(v)), "Enter a number")
  .transform((v) => (v === null ? null : Number(v).toFixed(2)));

const optDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null));

const updateProjectSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Name is required"),
  startDate: optDate,
  completeDate: optDate,
  notes: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),
  // Unit economics — only meaningful for kind='unit', ignored otherwise
  previousRent: optMoney,
  tradeOutRent: optMoney,
  leaseDate: optDate,
});

export async function updateProject(formData: FormData): Promise<ActionResult> {
  const parsed = updateProjectSchema.safeParse({
    projectId: formData.get("projectId"),
    name: formData.get("name"),
    startDate: formData.get("startDate"),
    completeDate: formData.get("completeDate"),
    notes: formData.get("notes"),
    previousRent: formData.get("previousRent"),
    tradeOutRent: formData.get("tradeOutRent"),
    leaseDate: formData.get("leaseDate"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, d.projectId),
  });
  if (!project) return { ok: false, error: "Project not found" };

  await db()
    .update(schema.projects)
    .set({
      name: d.name,
      startDate: d.startDate,
      completeDate: d.completeDate,
      notes: d.notes,
      // Only touch rent economics for unit projects
      ...(project.kind === "unit"
        ? { previousRent: d.previousRent, tradeOutRent: d.tradeOutRent, leaseDate: d.leaseDate }
        : {}),
    })
    .where(eq(schema.projects.id, d.projectId));

  revalidatePath(`/properties/${project.propertyId}`);
  revalidatePath(`/properties/${project.propertyId}/projects/${project.id}`);
  return { ok: true };
}

const phaseKeys = PROJECT_PHASES.map((p) => p.key) as [string, ...string[]];

const setPhaseSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  toPhase: z.enum(phaseKeys),
  note: z.string().trim().optional(),
});

export async function setProjectPhase(formData: FormData): Promise<ActionResult> {
  const parsed = setPhaseSchema.parse({
    projectId: formData.get("projectId"),
    toPhase: formData.get("toPhase"),
    note: formData.get("note") || undefined,
  });

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, parsed.projectId),
  });
  if (!project) return { ok: false, error: "Project not found" };
  if (project.phase === parsed.toPhase) return { ok: true };

  const toPhase = parsed.toPhase as typeof project.phase;

  await db()
    .update(schema.projects)
    .set({
      phase: toPhase,
      ...(toPhase === "in_process" && !project.startDate
        ? { startDate: new Date().toLocaleDateString("en-CA") }
        : {}),
      ...(toPhase === "complete" && !project.completeDate
        ? { completeDate: new Date().toLocaleDateString("en-CA") }
        : {}),
    })
    .where(eq(schema.projects.id, parsed.projectId));

  await db().insert(schema.projectStageEvents).values({
    projectId: parsed.projectId,
    toStage: project.stage,
    fromPhase: project.phase,
    toPhase,
    note: parsed.note,
  });

  // Auto-stamp actual date on milestones tied to the new phase
  const today = new Date().toLocaleDateString("en-CA");
  await db()
    .update(schema.projectMilestones)
    .set({ actualDate: today })
    .where(
      and(
        eq(schema.projectMilestones.projectId, parsed.projectId),
        eq(schema.projectMilestones.phase, toPhase),
        isNull(schema.projectMilestones.actualDate),
      ),
    );

  revalidatePath(`/properties/${project.propertyId}`);
  revalidatePath(`/properties/${project.propertyId}/projects/${project.id}`);
  revalidatePath("/");
  return { ok: true };
}

const projectIdSchema = z.object({ projectId: z.coerce.number().int().positive() });

export async function archiveProject(formData: FormData): Promise<ActionResult> {
  const parsed = projectIdSchema.safeParse({ projectId: formData.get("projectId") });
  if (!parsed.success) return { ok: false, error: "Invalid project" };

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, parsed.data.projectId),
  });
  if (!project) return { ok: false, error: "Project not found" };

  await db()
    .update(schema.projects)
    .set({ archivedAt: new Date() })
    .where(eq(schema.projects.id, parsed.data.projectId));

  revalidatePath(`/properties/${project.propertyId}`);
  revalidatePath(`/properties/${project.propertyId}/projects/${project.id}`);
  revalidatePath(`/properties/${project.propertyId}/projects/archived`);
  return { ok: true };
}

export async function restoreProject(formData: FormData): Promise<ActionResult> {
  const parsed = projectIdSchema.safeParse({ projectId: formData.get("projectId") });
  if (!parsed.success) return { ok: false, error: "Invalid project" };

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, parsed.data.projectId),
  });
  if (!project) return { ok: false, error: "Project not found" };

  await db()
    .update(schema.projects)
    .set({ archivedAt: null })
    .where(eq(schema.projects.id, parsed.data.projectId));

  revalidatePath(`/properties/${project.propertyId}`);
  revalidatePath(`/properties/${project.propertyId}/projects/${project.id}`);
  revalidatePath(`/properties/${project.propertyId}/projects/archived`);
  return { ok: true };
}
