import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Who can be put on a walk.
 *
 * Two lists, because a walk has two kinds of attendee and they mean different
 * things. Somebody on the team is ASSIGNED — a construction manager putting
 * their superintendent on a walk, and that person can open the walk and work
 * it. A vendor contact is INVITED — they cannot log in, so all they get is an
 * email telling them where to be.
 *
 * Server-only. The picker takes these as plain data.
 */

export type TeamOption = {
  profileId: string;
  name: string;
  email: string;
  role: string;
};

export type VendorContactOption = {
  vendorContactId: number;
  name: string;
  email: string;
  vendorName: string;
};

export type AttendeeRoster = {
  team: TeamOption[];
  vendors: VendorContactOption[];
};

export async function readAttendeeRoster(): Promise<AttendeeRoster> {
  const [profiles, contacts] = await Promise.all([
    // Every active person, not only the write-capable ones: a `site` user is
    // exactly who gets sent to walk a building.
    db()
      .select({
        profileId: schema.profiles.id,
        fullName: schema.profiles.fullName,
        email: schema.profiles.email,
        role: schema.profiles.role,
      })
      .from(schema.profiles)
      .where(isNull(schema.profiles.archivedAt))
      .orderBy(asc(schema.profiles.fullName), asc(schema.profiles.email)),

    // Only contacts we can actually reach. An invitation is an email, so a
    // contact without one cannot be invited and should not be offered.
    db()
      .select({
        vendorContactId: schema.vendorContacts.id,
        name: schema.vendorContacts.name,
        email: schema.vendorContacts.email,
        vendorName: schema.vendors.name,
      })
      .from(schema.vendorContacts)
      .innerJoin(schema.vendors, eq(schema.vendors.id, schema.vendorContacts.vendorId))
      .where(and(eq(schema.vendorContacts.active, true)))
      .orderBy(asc(schema.vendors.name), asc(schema.vendorContacts.name)),
  ]);

  return {
    team: profiles.map((p) => ({
      profileId: p.profileId,
      name: p.fullName?.trim() || p.email,
      email: p.email,
      role: p.role,
    })),
    vendors: contacts
      .filter((c): c is typeof c & { email: string } => !!c.email)
      .map((c) => ({
        vendorContactId: c.vendorContactId,
        name: c.name,
        email: c.email,
        vendorName: c.vendorName,
      })),
  };
}

/** The people already on a walk, in one query per identity kind. */
export async function readWalkAttendees(auditId: number) {
  const rows = await db()
    .select({
      id: schema.auditAttendees.id,
      role: schema.auditAttendees.role,
      invitedAt: schema.auditAttendees.invitedAt,
      respondedAt: schema.auditAttendees.respondedAt,
      profileId: schema.auditAttendees.profileId,
      profileName: schema.profiles.fullName,
      profileEmail: schema.profiles.email,
      vendorContactId: schema.auditAttendees.vendorContactId,
      contactName: schema.vendorContacts.name,
      contactEmail: schema.vendorContacts.email,
      vendorName: schema.vendors.name,
    })
    .from(schema.auditAttendees)
    .leftJoin(schema.profiles, eq(schema.profiles.id, schema.auditAttendees.profileId))
    .leftJoin(
      schema.vendorContacts,
      eq(schema.vendorContacts.id, schema.auditAttendees.vendorContactId),
    )
    .leftJoin(schema.vendors, eq(schema.vendors.id, schema.vendorContacts.vendorId))
    .where(eq(schema.auditAttendees.auditId, auditId))
    .orderBy(asc(schema.auditAttendees.id));

  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    invitedAt: r.invitedAt,
    respondedAt: r.respondedAt,
    kind: (r.profileId ? "team" : "vendor") as "team" | "vendor",
    name: r.profileId ? (r.profileName?.trim() || r.profileEmail || "—") : (r.contactName ?? "—"),
    email: r.profileId ? r.profileEmail : r.contactEmail,
    /** The company, for a vendor contact. Null for a team member. */
    company: r.profileId ? null : r.vendorName,
  }));
}

export type WalkAttendee = Awaited<ReturnType<typeof readWalkAttendees>>[number];
