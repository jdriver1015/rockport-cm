"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, gt, lt, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/action-result";

function revalidateAudits(propertyId: number, auditId?: number) {
  revalidatePath(`/properties/${propertyId}/audits`);
  if (auditId) revalidatePath(`/properties/${propertyId}/audits/${auditId}`);
}

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

// ---------------------------------------------------------------------------
// Audits
// ---------------------------------------------------------------------------

const createAuditSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  title: z.string().trim().min(1, "Title is required"),
  auditDate: z.string().trim().min(1, "Date is required"),
  auditorName: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),
  notes: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function createAudit(
  formData: FormData,
): Promise<ActionResult<{ auditId: number }>> {
  const parsed = createAuditSchema.safeParse({
    propertyId: formData.get("propertyId"),
    title: formData.get("title"),
    auditDate: formData.get("auditDate"),
    auditorName: formData.get("auditorName"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const user = await currentUser();
  const [row] = await db()
    .insert(schema.siteAudits)
    .values({
      propertyId: d.propertyId,
      title: d.title,
      auditDate: d.auditDate,
      auditorName: d.auditorName,
      notes: d.notes,
      createdBy: user?.id ?? null,
    })
    .returning({ id: schema.siteAudits.id });

  revalidateAudits(d.propertyId);
  return { ok: true, auditId: row.id };
}

export async function updateAudit(input: {
  id: number;
  propertyId: number;
  title?: string;
  auditDate?: string;
  auditorName?: string | null;
  notes?: string | null;
}): Promise<ActionResult> {
  const set: Partial<typeof schema.siteAudits.$inferInsert> = {};
  if (input.title !== undefined) {
    const t = input.title.trim();
    if (!t) return { ok: false, error: "Title is required" };
    set.title = t;
  }
  if (input.auditDate !== undefined) {
    if (!input.auditDate) return { ok: false, error: "Date is required" };
    set.auditDate = input.auditDate;
  }
  if (input.auditorName !== undefined) set.auditorName = input.auditorName?.trim() || null;
  if (input.notes !== undefined) set.notes = input.notes?.trim() || null;

  if (Object.keys(set).length === 0) return { ok: true };
  await db().update(schema.siteAudits).set(set).where(eq(schema.siteAudits.id, input.id));
  revalidateAudits(input.propertyId, input.id);
  return { ok: true };
}

export async function setAuditStatus(input: {
  id: number;
  propertyId: number;
  status: "draft" | "complete";
}): Promise<ActionResult> {
  await db()
    .update(schema.siteAudits)
    .set({ status: input.status })
    .where(eq(schema.siteAudits.id, input.id));
  revalidateAudits(input.propertyId, input.id);
  return { ok: true };
}

export async function deleteAudit(input: { id: number; propertyId: number }): Promise<ActionResult> {
  await db()
    .update(schema.siteAudits)
    .set({ archivedAt: new Date() })
    .where(eq(schema.siteAudits.id, input.id));
  revalidateAudits(input.propertyId, input.id);
  return { ok: true };
}

export async function restoreAudit(input: { id: number; propertyId: number }): Promise<ActionResult> {
  await db()
    .update(schema.siteAudits)
    .set({ archivedAt: null })
    .where(eq(schema.siteAudits.id, input.id));
  revalidateAudits(input.propertyId, input.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

const SEVERITIES = ["low", "medium", "high"] as const;
const FINDING_STATUSES = ["open", "resolved"] as const;

export async function createFinding(input: {
  auditId: number;
  propertyId: number;
  title: string;
}): Promise<ActionResult<{ findingId: number }>> {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Title is required" };

  const [{ maxOrder }] = await db()
    .select({ maxOrder: sql<number>`coalesce(max(${schema.auditFindings.sortIndex}), 0)::int` })
    .from(schema.auditFindings)
    .where(eq(schema.auditFindings.auditId, input.auditId));

  const [row] = await db()
    .insert(schema.auditFindings)
    .values({ auditId: input.auditId, title, sortIndex: maxOrder + 1 })
    .returning({ id: schema.auditFindings.id });

  revalidateAudits(input.propertyId, input.auditId);
  return { ok: true, findingId: row.id };
}

export async function updateFinding(input: {
  id: number;
  propertyId: number;
  auditId: number;
  title?: string;
  description?: string | null;
  location?: string | null;
  severity?: (typeof SEVERITIES)[number];
  status?: (typeof FINDING_STATUSES)[number];
  assignee?: string | null;
  dueDate?: string | null;
}): Promise<ActionResult> {
  const set: Partial<typeof schema.auditFindings.$inferInsert> = {};
  if (input.title !== undefined) {
    const t = input.title.trim();
    if (!t) return { ok: false, error: "Title is required" };
    set.title = t;
  }
  if (input.description !== undefined) set.description = input.description?.trim() || null;
  if (input.location !== undefined) set.location = input.location?.trim() || null;
  if (input.severity !== undefined) {
    if (!SEVERITIES.includes(input.severity)) return { ok: false, error: "Invalid severity" };
    set.severity = input.severity;
  }
  if (input.status !== undefined) {
    if (!FINDING_STATUSES.includes(input.status)) return { ok: false, error: "Invalid status" };
    set.status = input.status;
  }
  if (input.assignee !== undefined) set.assignee = input.assignee?.trim() || null;
  if (input.dueDate !== undefined) set.dueDate = input.dueDate?.trim() || null;

  if (Object.keys(set).length === 0) return { ok: true };
  await db().update(schema.auditFindings).set(set).where(eq(schema.auditFindings.id, input.id));
  revalidateAudits(input.propertyId, input.auditId);
  return { ok: true };
}

export async function deleteFinding(input: {
  id: number;
  propertyId: number;
  auditId: number;
}): Promise<ActionResult> {
  await db()
    .update(schema.auditFindings)
    .set({ archivedAt: new Date() })
    .where(eq(schema.auditFindings.id, input.id));
  revalidateAudits(input.propertyId, input.auditId);
  return { ok: true };
}

export async function restoreFinding(input: {
  id: number;
  propertyId: number;
  auditId: number;
}): Promise<ActionResult> {
  await db()
    .update(schema.auditFindings)
    .set({ archivedAt: null })
    .where(eq(schema.auditFindings.id, input.id));
  revalidateAudits(input.propertyId, input.auditId);
  return { ok: true };
}

/** Move a finding up or down by swapping sortIndex with its neighbor. */
export async function moveFinding(input: {
  id: number;
  propertyId: number;
  auditId: number;
  direction: "up" | "down";
}): Promise<ActionResult> {
  const current = await db().query.auditFindings.findFirst({
    where: eq(schema.auditFindings.id, input.id),
  });
  if (!current) return { ok: false, error: "Finding not found" };

  const neighbor = await db()
    .select()
    .from(schema.auditFindings)
    .where(
      and(
        eq(schema.auditFindings.auditId, input.auditId),
        input.direction === "up"
          ? lt(schema.auditFindings.sortIndex, current.sortIndex)
          : gt(schema.auditFindings.sortIndex, current.sortIndex),
      ),
    )
    .orderBy(
      input.direction === "up"
        ? desc(schema.auditFindings.sortIndex)
        : asc(schema.auditFindings.sortIndex),
    )
    .limit(1);

  if (neighbor.length === 0) return { ok: true }; // already at the edge
  const other = neighbor[0];

  await db()
    .update(schema.auditFindings)
    .set({ sortIndex: other.sortIndex })
    .where(eq(schema.auditFindings.id, current.id));
  await db()
    .update(schema.auditFindings)
    .set({ sortIndex: current.sortIndex })
    .where(eq(schema.auditFindings.id, other.id));

  revalidateAudits(input.propertyId, input.auditId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export async function updatePhotoCaption(input: {
  id: number;
  propertyId: number;
  auditId: number;
  caption: string;
}): Promise<ActionResult> {
  await db()
    .update(schema.auditPhotos)
    .set({ caption: input.caption.trim() || null })
    .where(eq(schema.auditPhotos.id, input.id));
  revalidateAudits(input.propertyId, input.auditId);
  return { ok: true };
}

export async function deletePhoto(input: {
  id: number;
  propertyId: number;
  auditId: number;
}): Promise<ActionResult> {
  await db()
    .update(schema.auditPhotos)
    .set({ archivedAt: new Date() })
    .where(eq(schema.auditPhotos.id, input.id));
  revalidateAudits(input.propertyId, input.auditId);
  return { ok: true };
}

export async function restorePhoto(input: {
  id: number;
  propertyId: number;
  auditId: number;
}): Promise<ActionResult> {
  await db()
    .update(schema.auditPhotos)
    .set({ archivedAt: null })
    .where(eq(schema.auditPhotos.id, input.id));
  revalidateAudits(input.propertyId, input.auditId);
  return { ok: true };
}

/** Move a photo left/right within its finding by swapping sortIndex. */
export async function movePhoto(input: {
  id: number;
  propertyId: number;
  auditId: number;
  direction: "up" | "down";
}): Promise<ActionResult> {
  const current = await db().query.auditPhotos.findFirst({
    where: eq(schema.auditPhotos.id, input.id),
  });
  if (!current) return { ok: false, error: "Photo not found" };

  const neighbor = await db()
    .select()
    .from(schema.auditPhotos)
    .where(
      and(
        eq(schema.auditPhotos.findingId, current.findingId),
        input.direction === "up"
          ? lt(schema.auditPhotos.sortIndex, current.sortIndex)
          : gt(schema.auditPhotos.sortIndex, current.sortIndex),
      ),
    )
    .orderBy(
      input.direction === "up"
        ? desc(schema.auditPhotos.sortIndex)
        : asc(schema.auditPhotos.sortIndex),
    )
    .limit(1);

  if (neighbor.length === 0) return { ok: true };
  const other = neighbor[0];

  await db()
    .update(schema.auditPhotos)
    .set({ sortIndex: other.sortIndex })
    .where(eq(schema.auditPhotos.id, current.id));
  await db()
    .update(schema.auditPhotos)
    .set({ sortIndex: current.sortIndex })
    .where(eq(schema.auditPhotos.id, other.id));

  revalidateAudits(input.propertyId, input.auditId);
  return { ok: true };
}
