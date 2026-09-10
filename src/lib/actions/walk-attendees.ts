"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { canWriteProperty } from "@/lib/auth-rules";
import type { ActionResult } from "@/lib/action-result";
import { propertyPath } from "@/lib/property-path";
import { sendEmail } from "@/lib/email";
import { fmtDate, fmtTime } from "@/lib/format";

// ---------------------------------------------------------------------------
// Who is on a walk.
//
// Adding a team member is an assignment: they can open the walk and work it,
// so nothing is sent and there is nothing to accept. Adding a vendor contact
// is an invitation to somebody who cannot log in, so the only thing that
// reaches them is an email — and sending it is a separate, deliberate press
// rather than a side effect of adding a row.
// ---------------------------------------------------------------------------

async function loadWalk(auditId: number) {
  return db()
    .select({
      id: schema.siteAudits.id,
      title: schema.siteAudits.title,
      auditDate: schema.siteAudits.auditDate,
      walkTime: schema.siteAudits.walkTime,
      propertyId: schema.siteAudits.propertyId,
      propertyName: schema.properties.name,
      propertyAddress: schema.properties.address,
      propertyCity: schema.properties.city,
    })
    .from(schema.siteAudits)
    .innerJoin(schema.properties, eq(schema.properties.id, schema.siteAudits.propertyId))
    .where(eq(schema.siteAudits.id, auditId))
    .limit(1)
    .then((r) => r[0] ?? null);
}

async function revalidateWalk(propertyId: number, auditId: number) {
  const base = await propertyPath(propertyId);
  if (base) {
    revalidatePath(`${base}/audits/${auditId}`);
    revalidatePath(`${base}/audits`);
  }
}

const addSchema = z
  .object({
    auditId: z.coerce.number().int().positive(),
    profileId: z.string().uuid().optional(),
    vendorContactId: z.coerce.number().int().positive().optional(),
    role: z.enum(["organizer", "required", "optional"]).default("required"),
  })
  // Mirrors the database's own check, so a bad call fails here with a sentence
  // rather than at the constraint with a Postgres error.
  .refine((v) => !!v.profileId !== !!v.vendorContactId, {
    message: "Pick either a team member or a vendor contact",
  });

export async function addWalkAttendee(input: z.input<typeof addSchema>): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to change who is on a walk" };
  }
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { auditId, profileId, vendorContactId, role } = parsed.data;

  const walk = await loadWalk(auditId);
  if (!walk) return { ok: false, error: "Walk not found" };

  try {
    await db().insert(schema.auditAttendees).values({
      auditId,
      profileId: profileId ?? null,
      vendorContactId: vendorContactId ?? null,
      role,
    });
  } catch {
    // The unique indexes make a double-add a constraint violation rather than a
    // duplicate row. Saying so beats surfacing the raw error.
    return { ok: false, error: "They are already on this walk" };
  }

  await revalidateWalk(walk.propertyId, auditId);
  return { ok: true };
}

const idSchema = z.object({ id: z.coerce.number().int().positive() });

export async function removeWalkAttendee(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to change who is on a walk" };
  }
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid attendee" };

  const [row] = await db()
    .select({ auditId: schema.auditAttendees.auditId })
    .from(schema.auditAttendees)
    .where(eq(schema.auditAttendees.id, parsed.data.id))
    .limit(1);
  if (!row) return { ok: true };

  await db().delete(schema.auditAttendees).where(eq(schema.auditAttendees.id, parsed.data.id));

  const walk = await loadWalk(row.auditId);
  if (walk) await revalidateWalk(walk.propertyId, row.auditId);
  return { ok: true };
}

/**
 * Email a vendor contact where and when to be.
 *
 * No link. A vendor has no login and there is no tokenised walk portal, so a
 * URL here would be one they cannot open — the invitation is the information.
 * sendEmail still refuses to send from a localhost origin, which for this
 * message is stricter than it needs to be but is the right default: it stops a
 * dev run mailing a real subcontractor.
 */
export async function inviteWalkAttendee(input: z.input<typeof idSchema>): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (!canWriteProperty(auth.profile.role)) {
    return { ok: false, error: "You don't have permission to invite to a walk" };
  }
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid attendee" };

  const [row] = await db()
    .select({
      id: schema.auditAttendees.id,
      auditId: schema.auditAttendees.auditId,
      profileId: schema.auditAttendees.profileId,
      contactName: schema.vendorContacts.name,
      contactEmail: schema.vendorContacts.email,
    })
    .from(schema.auditAttendees)
    .leftJoin(
      schema.vendorContacts,
      eq(schema.vendorContacts.id, schema.auditAttendees.vendorContactId),
    )
    .where(eq(schema.auditAttendees.id, parsed.data.id))
    .limit(1);

  if (!row) return { ok: false, error: "Attendee not found" };
  if (row.profileId) {
    return { ok: false, error: "Team members are assigned, not invited — they can open the walk" };
  }
  if (!row.contactEmail) return { ok: false, error: "That contact has no email address" };

  const walk = await loadWalk(row.auditId);
  if (!walk) return { ok: false, error: "Walk not found" };

  const when = `${fmtDate(walk.auditDate)}${walk.walkTime ? ` at ${fmtTime(walk.walkTime)}` : ""}`;
  const where = [walk.propertyName, walk.propertyAddress, walk.propertyCity]
    .filter(Boolean)
    .join(", ");
  const organiser = auth.profile.email;

  const text = [
    `${row.contactName ?? "Hello"},`,
    "",
    `You are asked to join a site walk: ${walk.title}.`,
    "",
    `When: ${when}`,
    `Where: ${where}`,
    "",
    `Reply to ${organiser} if that does not work.`,
  ].join("\n");

  const html = `<p>${row.contactName ?? "Hello"},</p>
<p>You are asked to join a site walk: <strong>${walk.title}</strong>.</p>
<p><strong>When:</strong> ${when}<br/><strong>Where:</strong> ${where}</p>
<p>Reply to ${organiser} if that does not work.</p>`;

  const outcome = await sendEmail({
    to: row.contactEmail,
    subject: `Site walk — ${walk.propertyName} — ${when}`,
    text,
    html,
    replyTo: organiser,
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  await db()
    .update(schema.auditAttendees)
    .set({ invitedAt: new Date() })
    .where(and(eq(schema.auditAttendees.id, parsed.data.id)));

  await revalidateWalk(walk.propertyId, row.auditId);
  return { ok: true };
}
