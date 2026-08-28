"use server";

import { revalidatePath } from "next/cache";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { propertyProjectPath } from "@/lib/property-path";
import { sendBidPackageRows } from "@/lib/bid-package";
import { issueBidToken } from "@/lib/bid-portal";
import { recordBidEvent } from "@/lib/bid-events";
import { invitationHtml, invitationSubject, invitationText } from "@/lib/bid-invitation";
import { appOrigin, mailConfigured, sendEmail } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";
import { resolveVendorContacts } from "@/lib/vendor-contact";

const schemaIn = z.object({
  propertyId: z.coerce.number().int().positive(),
  projectId: z.coerce.number().int().positive(),
  vendorIds: z.array(z.coerce.number().int().positive()).min(1, "Pick at least one vendor"),
  scopeItemIds: z.array(z.coerce.number().int().positive()).min(1, "Pick at least one scope item"),
  dueDate: z.string().trim().nullable().optional(),
});

export type InvitationOutcome = {
  vendorId: number;
  vendorName: string;
  /** Null when the vendor has no contact to write to. */
  email: string | null;
  /** The private link, so it can be copied when mail is not configured. */
  link: string | null;
  status: "sent" | "no_email" | "not_configured" | "failed" | "skipped";
  detail?: string;
};

export type SendInvitationsResult =
  | { ok: true; outcomes: InvitationOutcome[]; mailConfigured: boolean }
  | { ok: false; error: string };

/**
 * Create the requests, mint each vendor its own link, and send the invitations.
 *
 * These used to be three separate acts: sending created bid rows, a button
 * minted a link some time later, and a person pasted it into Outlook. A bid
 * could sit "sent" with no link behind it, and nothing recorded that anybody had
 * been told. One call now, and every step is written down.
 *
 * A vendor that cannot be mailed is not a failure of the send — the request
 * exists and the link is real, so the outcome says so and hands the link back to
 * be delivered by hand.
 */
export async function sendBidInvitations(
  input: z.input<typeof schemaIn>,
): Promise<SendInvitationsResult> {
  const parsed = schemaIn.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const d = parsed.data;

  const res = await sendBidPackageRows(d.projectId, d.vendorIds, d.scopeItemIds, d.dueDate ?? null);
  if (!res.ok) return res;

  const [project] = await db()
    .select({
      projectName: schema.projects.name,
      propertyName: schema.properties.name,
    })
    .from(schema.projects)
    .innerJoin(schema.properties, eq(schema.properties.id, schema.projects.propertyId))
    .where(eq(schema.projects.id, d.projectId))
    .limit(1);

  const scopeItems = await db()
    .select({ item: schema.scopeItems.item, costCodeName: schema.costCodes.name })
    .from(schema.scopeItems)
    .leftJoin(schema.costCodes, eq(schema.costCodes.id, schema.scopeItems.costCodeId))
    .where(inArray(schema.scopeItems.id, d.scopeItemIds))
    .orderBy(asc(schema.scopeItems.sortOrder), asc(schema.scopeItems.id));

  const vendorRows = await db()
    .select({ id: schema.vendors.id, name: schema.vendors.name })
    .from(schema.vendors)
    .where(inArray(schema.vendors.id, d.vendorIds));
  const vendorName = new Map(vendorRows.map((v) => [v.id, v.name]));

  // One resolved contact per vendor, the same one the preview showed and the
  // same one the vendor step listed. A vendor with several people is written to
  // once rather than a copy each: the link is the credential, and handing it to
  // three inboxes multiplies where it can leak from.
  const contactFor = await resolveVendorContacts(d.vendorIds);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user
    ? await db().query.profiles.findFirst({ where: eq(schema.profiles.id, user.id) })
    : null;
  const senderName = profile?.fullName ?? null;

  const configured = mailConfigured();
  const outcomes: InvitationOutcome[] = [];

  for (const s of res.skipped) {
    outcomes.push({
      vendorId: s.vendorId,
      vendorName: vendorName.get(s.vendorId) ?? "Vendor",
      email: contactFor.get(s.vendorId)?.email ?? null,
      link: null,
      status: "skipped",
      detail: s.reason,
    });
  }

  const deliveries = res.created.map(async (c) => {
    const name = vendorName.get(c.vendorId) ?? "Vendor";
    const contact = contactFor.get(c.vendorId) ?? null;
    const address = contact?.email ?? null;

    // Minted regardless of whether mail goes out: the request is real, and a
    // link nobody can reach is the state this replaced.
    const { token } = await issueBidToken(c.bidId, user?.id ?? null);
    const link = `${appOrigin()}/bid/${token}`;

    if (!address) {
      await recordBidEvent(c.bidId, "invited", { delivery: "no contact on file" });
      return {
        vendorId: c.vendorId,
        vendorName: name,
        email: null,
        link,
        status: "no_email" as const,
      };
    }

    const mail = {
      vendorName: name,
      contactName: contact?.name ?? null,
      propertyName: project?.propertyName ?? "",
      projectName: project?.projectName ?? "",
      scopeItems,
      token,
      dueDate: d.dueDate ?? null,
      senderName,
      bidId: c.bidId,
    };

    if (!configured) {
      await recordBidEvent(c.bidId, "invited", { delivery: "not configured", to: address });
      return {
        vendorId: c.vendorId,
        vendorName: name,
        email: address,
        link,
        status: "not_configured" as const,
      };
    }

    const sent = await sendEmail({
      to: address,
      subject: invitationSubject(mail),
      html: invitationHtml(mail),
      text: invitationText(mail),
    });

    await recordBidEvent(c.bidId, "invited", {
      to: address,
      delivery: sent.ok ? "sent" : "failed",
    });

    return {
      vendorId: c.vendorId,
      vendorName: name,
      email: address,
      link,
      status: (sent.ok ? "sent" : "failed") as InvitationOutcome["status"],
      detail: sent.ok ? undefined : sent.error,
    };
  });

  // In parallel, so the wall clock is one provider round trip rather than one
  // per vendor. Sequentially, a slow provider could exhaust the request budget
  // partway down the list and strand the rest with a bid and a link but no
  // invitation — and re-running would skip them as "already has a live request".
  outcomes.push(...(await Promise.all(deliveries)));

  const path = await propertyProjectPath(d.propertyId, d.projectId);
  if (path) revalidatePath(path);

  return { ok: true, outcomes, mailConfigured: configured };
}

const previewSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  vendorId: z.coerce.number().int().positive(),
  scopeItemIds: z.array(z.coerce.number().int().positive()).min(1),
  dueDate: z.string().trim().nullable().optional(),
});

export type InvitationPreview = {
  subject: string;
  html: string;
  to: string | null;
  vendorName: string;
};

/**
 * Render the invitation for one vendor without sending it.
 *
 * Deliberately the same template the send uses, called the same way — a preview
 * built from a second, similar-looking string would drift, and the whole point
 * of showing it is that what you approve is what goes out. The token is a
 * placeholder because none exists until the request is created.
 */
export async function previewBidInvitation(
  input: z.input<typeof previewSchema>,
): Promise<{ ok: true; preview: InvitationPreview } | { ok: false; error: string }> {
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const d = parsed.data;

  const [project] = await db()
    .select({ projectName: schema.projects.name, propertyName: schema.properties.name })
    .from(schema.projects)
    .innerJoin(schema.properties, eq(schema.properties.id, schema.projects.propertyId))
    .where(eq(schema.projects.id, d.projectId))
    .limit(1);
  if (!project) return { ok: false, error: "Project not found" };

  const [vendor] = await db()
    .select({ name: schema.vendors.name })
    .from(schema.vendors)
    .where(eq(schema.vendors.id, d.vendorId))
    .limit(1);
  if (!vendor) return { ok: false, error: "Vendor not found" };

  const scopeItems = await db()
    .select({ item: schema.scopeItems.item, costCodeName: schema.costCodes.name })
    .from(schema.scopeItems)
    .leftJoin(schema.costCodes, eq(schema.costCodes.id, schema.scopeItems.costCodeId))
    .where(inArray(schema.scopeItems.id, d.scopeItemIds))
    .orderBy(asc(schema.scopeItems.sortOrder), asc(schema.scopeItems.id));

  // The same resolution the send uses, so the draft names the person who will
  // actually receive it.
  const contact = (await resolveVendorContacts([d.vendorId])).get(d.vendorId) ?? null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user
    ? await db().query.profiles.findFirst({ where: eq(schema.profiles.id, user.id) })
    : null;

  const mail = {
    vendorName: vendor.name,
    contactName: contact?.name ?? null,
    propertyName: project.propertyName,
    projectName: project.projectName,
    scopeItems,
    token: "PREVIEW",
    dueDate: d.dueDate ?? null,
    senderName: profile?.fullName ?? null,
    bidId: 0,
    preview: true,
  };

  return {
    ok: true,
    preview: {
      subject: invitationSubject(mail),
      html: invitationHtml(mail),
      to: contact?.email ?? null,
      vendorName: vendor.name,
    },
  };
}
