"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { PROJECT_PHASES, phaseLabel } from "@/lib/stages";

import { requireUser } from "@/lib/auth";
import { canWriteProperty } from "@/lib/auth-rules";
import type { ActionResult } from "@/lib/action-result";
import { propertyPath } from "@/lib/property-path";
import { projectSlug } from "@/lib/slug";
import { defaultMilestoneRows } from "@/lib/milestones";
import { slipOverdueTargets } from "@/lib/target-slip";
import { logFieldChange, logFieldChanges } from "@/lib/actions/activity-log";
import { isAssignableManager } from "@/lib/manager-roster";
import { managerName } from "@/lib/project-managers";
import { money, fmtDate } from "@/lib/format";

/**
 * Creating takes a name and nothing else.
 *
 * The cost code, the budget and the dates are all set on the project's own
 * screen. They used to be required here, which meant committing to a budget for
 * something that did not exist yet — and a cost code chosen from a dropdown of
 * eighty, before anyone had looked at the work.
 */
const createProjectSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  kind: z.enum(["unit", "common"]),
  name: z.string().trim().min(1, "Give the project a name"),
  unitNumber: z.string().trim().min(1).optional(),
});

export async function createProject(
  formData: FormData,
): Promise<ActionResult<{ projectId: number; slug: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const parsed = createProjectSchema.safeParse({
    propertyId: formData.get("propertyId"),
    kind: formData.get("kind"),
    name: formData.get("name"),
    unitNumber: formData.get("unitNumber") || undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, d.propertyId),
    columns: { id: true },
  });
  if (!property) return { ok: false, error: "Property not found" };

  let unitId: number | undefined;

  if (d.kind === "unit") {
    if (!d.unitNumber) return { ok: false, error: "Unit number is required for a unit project" };
    const existing = await db().query.units.findFirst({
      where: and(
        eq(schema.units.propertyId, d.propertyId),
        eq(schema.units.unitNumber, d.unitNumber),
      ),
    });
    if (existing) {
      unitId = existing.id;
    } else {
      const [unit] = await db()
        .insert(schema.units)
        .values({ propertyId: d.propertyId, unitNumber: d.unitNumber })
        .returning();
      unitId = unit.id;
    }
  }

  const [project] = await db()
    .insert(schema.projects)
    .values({
      propertyId: d.propertyId,
      kind: d.kind,
      name: d.name,
      unitId,
    })
    .returning();

  await logFieldChange({
    projectId: project.id,
    userId: auth.profile.id,
    field: "phase",
    fieldLabel: "Phase",
    from: null,
    to: phaseLabel("precon"),
    note: "Project created",
  });

  // Every project starts with the four phase milestones; setProjectPhase stamps
  // their actual dates as the project advances.
  await db().insert(schema.projectMilestones).values(defaultMilestoneRows(project.id));

  const createdPath = await propertyPath(d.propertyId);
  if (createdPath) revalidatePath(createdPath);
  return { ok: true, projectId: project.id, slug: projectSlug(project) };
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
  /**
   * The UW line item this project reconciles to, and its approved budget. Set
   * here rather than at creation — creating asks for a name and nothing else,
   * so this is the only place either is chosen.
   *
   * Empty clears them: a project can genuinely be uncoded or unbudgeted while
   * it is being worked out, and the cost bar says so.
   */
  costCodeId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || Number.isInteger(v), "Invalid cost code"),
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

/** Notes can run long in the edit form — cap what lands in a log table cell. */
function truncate(s: string | null, max = 140): string | null {
  if (s == null) return null;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export async function updateProject(formData: FormData): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const parsed = updateProjectSchema.safeParse({
    projectId: formData.get("projectId"),
    name: formData.get("name"),
    // `?? undefined` on every optional field, not just the coded one.
    //
    // FormData.get returns null for a field the form never rendered, and these
    // optional schemas are z.string().optional() — they take undefined and
    // reject null. The rent fields and the cost code only render for one kind
    // of project, so editing the OTHER kind failed validation with "expected
    // string, received null" before it wrote anything. A common-area project
    // could not be renamed, redated or annotated at all.
    costCodeId: formData.get("costCodeId") ?? undefined,
    startDate: formData.get("startDate") ?? undefined,
    completeDate: formData.get("completeDate") ?? undefined,
    notes: formData.get("notes") ?? undefined,
    previousRent: formData.get("previousRent") ?? undefined,
    tradeOutRent: formData.get("tradeOutRent") ?? undefined,
    leaseDate: formData.get("leaseDate") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, d.projectId),
  });
  if (!project) return { ok: false, error: "Project not found" };

  // The code has to belong to this property's chart. This check used to live on
  // creation; it follows the field here rather than being dropped, because a
  // project coded to another property's chart reconciles against nothing.
  if (d.costCodeId != null) {
    const [code, property] = await Promise.all([
      db().query.costCodes.findFirst({ where: eq(schema.costCodes.id, d.costCodeId) }),
      db().query.properties.findFirst({
        where: eq(schema.properties.id, project.propertyId),
        columns: { chartOfAccountsId: true },
      }),
    ]);
    if (!code) return { ok: false, error: "Cost code not found" };
    if (!property) return { ok: false, error: "Property not found" };
    if (code.chartId !== property.chartOfAccountsId) {
      return { ok: false, error: "That cost code isn't in this property's chart of accounts" };
    }
  }

  await db()
    .update(schema.projects)
    .set({
      name: d.name,
      // An interior turn spends across every 4000-series code, so a single UW
      // line item would be a lie. Its budget comes from the renovation template.
      // The cost code only. A project's budget is what its priced scope adds
      // up to — recomputeProjectBudget owns that column for every kind of
      // project, and this used to overwrite it on every save.
      //
      // Worse than a duplicate: the edit dialog has no budget input, so
      // formData.get("budgetAmount") was always null and `budget ?? 0` wrote
      // "0.00". Renaming a common-area project silently zeroed its budget until
      // the next scope edit put it back.
      ...(project.kind === "common" ? { costCodeId: d.costCodeId } : {}),
      startDate: d.startDate,
      completeDate: d.completeDate,
      notes: d.notes,
      // Only touch rent economics for unit projects
      ...(project.kind === "unit"
        ? { previousRent: d.previousRent, tradeOutRent: d.tradeOutRent, leaseDate: d.leaseDate }
        : {}),
    })
    .where(eq(schema.projects.id, d.projectId));

  await logFieldChanges({
    projectId: d.projectId,
    userId: auth.profile.id,
    changes: [
      { field: "name", fieldLabel: "Name", from: project.name, to: d.name },
      ...(project.kind === "common"
        ? [
            {
              field: "costCodeId",
              fieldLabel: "UW Line Item",
              from: project.costCodeId == null ? null : String(project.costCodeId),
              to: d.costCodeId == null ? null : String(d.costCodeId),
            },
          ]
        : []),
      { field: "startDate", fieldLabel: "Actual Start", from: fmtDate(project.startDate), to: fmtDate(d.startDate) },
      { field: "completeDate", fieldLabel: "Actual Completion", from: fmtDate(project.completeDate), to: fmtDate(d.completeDate) },
      { field: "notes", fieldLabel: "Notes", from: truncate(project.notes), to: truncate(d.notes) },
      ...(project.kind === "unit"
        ? [
            { field: "previousRent", fieldLabel: "Previous Rent", from: money(project.previousRent), to: money(d.previousRent) },
            { field: "tradeOutRent", fieldLabel: "Trade-Out Rent", from: money(project.tradeOutRent), to: money(d.tradeOutRent) },
            { field: "leaseDate", fieldLabel: "Lease Date", from: fmtDate(project.leaseDate), to: fmtDate(d.leaseDate) },
          ]
        : []),
    ],
  });

  const _base = await propertyPath(project.propertyId);
  if (_base) {
    revalidatePath(_base);
    revalidatePath(`${_base}/projects/${projectSlug(project)}`);
  }
  return { ok: true };
}

const phaseKeys = PROJECT_PHASES.map((p) => p.key) as [string, ...string[]];

const setPhaseSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  toPhase: z.enum(phaseKeys),
  note: z.string().trim().optional(),
});

export async function setProjectPhase(formData: FormData): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const parsed = setPhaseSchema.safeParse({
    projectId: formData.get("projectId"),
    toPhase: formData.get("toPhase"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, parsed.data.projectId),
  });
  if (!project) return { ok: false, error: "Project not found" };
  if (project.phase === parsed.data.toPhase) return { ok: true };

  const toPhase = parsed.data.toPhase as typeof project.phase;

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
    .where(eq(schema.projects.id, parsed.data.projectId));

  await logFieldChange({
    projectId: parsed.data.projectId,
    userId: auth.profile.id,
    field: "phase",
    fieldLabel: "Phase",
    from: project.phase ? phaseLabel(project.phase) : null,
    to: phaseLabel(toPhase),
    note: parsed.data.note ?? null,
  });

  // Auto-stamp actual date on milestones tied to the new phase
  const today = new Date().toLocaleDateString("en-CA");
  await db()
    .update(schema.projectMilestones)
    .set({ actualDate: today })
    .where(
      and(
        eq(schema.projectMilestones.projectId, parsed.data.projectId),
        eq(schema.projectMilestones.phase, toPhase),
        isNull(schema.projectMilestones.actualDate),
        isNull(schema.projectMilestones.archivedAt),
      ),
    );

  // Advancing re-bases what is still ahead, straight away rather than waiting
  // for the nightly pass: arriving at this phase late makes every date after it
  // impossible, and the schedule should say so before anyone reads it.
  const slip = await db().transaction((tx) =>
    slipOverdueTargets(tx, parsed.data.projectId, toPhase),
  );
  if (slip) {
    await logFieldChanges({
      projectId: parsed.data.projectId,
      userId: auth.profile.id,
      changes: slip.moved.map((m) => ({
        field: "milestone:plannedDate",
        fieldLabel: `${phaseLabel(m.phase)}: Target Start`,
        from: fmtDate(m.from),
        to: fmtDate(m.to),
      })),
      note: `Pushed ${slip.days} working day${slip.days === 1 ? "" : "s"} on entering ${phaseLabel(toPhase)}`,
    });
  }

  const _base = await propertyPath(project.propertyId);
  if (_base) {
    revalidatePath(_base);
    revalidatePath(`${_base}/projects/${projectSlug(project)}`);
  }
  revalidatePath("/");
  return { ok: true };
}

const setManagerSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  /** Absent clears the assignment — the picker's "Unassigned" choice. */
  managerId: z.string().uuid("That isn't a person on the roster").optional(),
});

/**
 * Name (or clear) the project's manager.
 *
 * Its own action rather than a field on updateProject, because the board assigns
 * inline: the alternative to one small write here is opening every project's
 * page to do a first pass over thirteen of them.
 */
export async function setProjectManager(formData: FormData): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to assign a project manager" };
  }

  // "" is the Unassigned choice, and z.string().uuid() would reject it. Mapped
  // to undefined before parsing so clearing is a valid input rather than an
  // error the picker has no way to show.
  const raw = formData.get("managerId");
  const parsed = setManagerSchema.safeParse({
    projectId: formData.get("projectId"),
    managerId: typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const managerId = parsed.data.managerId ?? null;

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, parsed.data.projectId),
  });
  if (!project) return { ok: false, error: "Project not found" };
  if ((project.managerId ?? null) === managerId) return { ok: true };

  // The picker only ever offers the roster, so a value that fails this came from
  // somewhere else — re-checked here rather than trusting the id.
  if (managerId && !(await isAssignableManager(managerId))) {
    return { ok: false, error: "That person can't be assigned as a project manager" };
  }

  const [was, now] = await Promise.all([
    readManagerLabel(project.managerId),
    readManagerLabel(managerId),
  ]);

  await db()
    .update(schema.projects)
    .set({ managerId })
    .where(eq(schema.projects.id, parsed.data.projectId));

  await logFieldChange({
    projectId: parsed.data.projectId,
    userId: auth.profile.id,
    field: "managerId",
    fieldLabel: "Project Manager",
    from: was,
    to: now,
  });

  const _base = await propertyPath(project.propertyId);
  if (_base) {
    revalidatePath(_base);
    revalidatePath(`${_base}/projects/${projectSlug(project)}`);
  }
  return { ok: true };
}

/** The name to write into the activity log — an id there would be unreadable. */
async function readManagerLabel(profileId: string | null): Promise<string | null> {
  if (!profileId) return null;
  const row = await db().query.profiles.findFirst({
    where: eq(schema.profiles.id, profileId),
    columns: { fullName: true, email: true },
  });
  return row ? managerName(row.fullName, row.email) : null;
}

const projectIdSchema = z.object({ projectId: z.coerce.number().int().positive() });

export async function archiveProject(formData: FormData): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to archive projects" };
  }

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

  const _base = await propertyPath(project.propertyId);
  if (_base) {
    revalidatePath(_base);
    revalidatePath(`${_base}/projects/${projectSlug(project)}`);
    revalidatePath(`${_base}/projects/archived`);
  }
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

  const _base = await propertyPath(project.propertyId);
  if (_base) {
    revalidatePath(_base);
    revalidatePath(`${_base}/projects/${projectSlug(project)}`);
    revalidatePath(`${_base}/projects/archived`);
  }
  return { ok: true };
}
