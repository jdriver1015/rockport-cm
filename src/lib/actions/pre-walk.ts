"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { propertyPath } from "@/lib/property-path";
import { importFindingsToScopeRows } from "@/lib/pre-walk-findings";

// ---------------------------------------------------------------------------
// The pre-walk: the visit that produces a project's scope.
//
// Two things live here — booking it (a date and a time on the project) and
// starting it (the site audit that records what was found). They are separate
// because a walk gets scheduled days before anyone stands in the unit, and the
// gate needs to tell those apart.
// ---------------------------------------------------------------------------

async function revalidateProject(propertyId: number, projectId: number) {
  const base = await propertyPath(propertyId);
  if (base) revalidatePath(`${base}/projects/${projectId}`);
}

const scheduleSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  /** Empty clears the booking — a walk can be un-scheduled. */
  date: z.string().trim().optional(),
  /** HH:MM. Optional: a date with no time is still a booking. */
  time: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time").optional().or(z.literal("")),
});

/** Book or clear the pre-walk. */
export async function schedulePreWalk(
  input: z.input<typeof scheduleSchema>,
): Promise<ActionResult> {
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { projectId, date, time } = parsed.data;

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { propertyId: true },
  });
  if (!project) return { ok: false, error: "Project not found" };

  await db()
    .update(schema.projects)
    .set({
      preWalkDate: date ? date : null,
      // A time without a date is not a booking, so clearing the date clears it.
      preWalkTime: date && time ? time : null,
    })
    .where(eq(schema.projects.id, projectId));

  await revalidateProject(project.propertyId, projectId);
  return { ok: true };
}

const startSchema = z.object({ projectId: z.coerce.number().int().positive() });

/**
 * Open the pre-walk — the audit that records what the walk found.
 *
 * Idempotent: if a pre-walk already exists it is returned rather than a second
 * one created, so the button is safe to press twice and a partial unique index
 * backs that up. Returns the audit id for the caller to navigate to.
 */
export async function startPreWalk(
  input: z.input<typeof startSchema>,
): Promise<ActionResult<{ auditId: number; created: boolean }>> {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { projectId } = parsed.data;

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { propertyId: true, preWalkDate: true, name: true },
  });
  if (!project) return { ok: false, error: "Project not found" };

  const existing = await db().query.siteAudits.findFirst({
    where: and(
      eq(schema.siteAudits.projectId, projectId),
      eq(schema.siteAudits.kind, "pre_walk"),
      isNull(schema.siteAudits.archivedAt),
    ),
    columns: { id: true },
  });
  if (existing) return { ok: true, auditId: existing.id, created: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user
    ? await db().query.profiles.findFirst({
        where: eq(schema.profiles.id, user.id),
        columns: { fullName: true },
      })
    : null;

  const [audit] = await db()
    .insert(schema.siteAudits)
    .values({
      propertyId: project.propertyId,
      projectId,
      kind: "pre_walk",
      // The audit list shows this title; naming it after the project makes a
      // pre-walk findable there without opening it.
      title: `${project.name} — Pre-walk`,
      // The booked date if there is one, otherwise today: someone standing in
      // the unit pressing this is walking it now.
      auditDate: project.preWalkDate ?? new Date().toLocaleDateString("en-CA"),
      auditorName: profile?.fullName ?? null,
      status: "draft",
    })
    .returning({ id: schema.siteAudits.id });

  await revalidateProject(project.propertyId, projectId);
  return { ok: true, auditId: audit.id, created: true };
}

const importSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  findingIds: z.array(z.coerce.number().int().positive()).min(1, "Pick at least one finding"),
});

/** Turn pre-walk findings into scope lines. Validation and revalidation only. */
export async function importFindingsToScope(
  input: z.input<typeof importSchema>,
): Promise<ActionResult<{ added: number; skipped: number }>> {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { projectId, findingIds } = parsed.data;

  const res = await importFindingsToScopeRows(projectId, findingIds);
  if (!res.ok) return res;

  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { propertyId: true },
  });
  if (project) await revalidateProject(project.propertyId, projectId);
  return { ok: true, added: res.added, skipped: res.skipped };
}
