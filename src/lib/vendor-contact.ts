import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

// ---------------------------------------------------------------------------
// Who at a vendor gets the invitation.
//
// This was answered three different ways: the wizard's vendor step took
// min(email) and min(name) as independent aggregates, the preview took the first
// active contact whether or not it had an address, and the send took the first
// active contact that did. So the list could show one person's name beside
// another's email, and the draft you approved could greet somebody other than
// the person who received it.
//
// One answer, used by all three.
// ---------------------------------------------------------------------------

export type VendorContact = {
  name: string | null;
  email: string | null;
};

/**
 * The contact an invitation would go to.
 *
 * The first active contact that has an address, because that is the one that can
 * actually be written to. A vendor whose only contacts have no address still
 * gets a name back — the request and its link are real and somebody has to be
 * told about them by hand — but a null email, so every caller can see that it
 * cannot be mailed.
 */
export function pickContact(
  contacts: { name: string | null; email: string | null }[],
): VendorContact | null {
  if (contacts.length === 0) return null;
  return contacts.find((c) => c.email?.trim()) ?? { name: contacts[0].name, email: null };
}

/** The chosen contact for each vendor, keyed by vendor id. */
export async function resolveVendorContacts(
  vendorIds: number[],
): Promise<Map<number, VendorContact>> {
  const out = new Map<number, VendorContact>();
  if (vendorIds.length === 0) return out;

  const rows = await db()
    .select({
      vendorId: schema.vendorContacts.vendorId,
      name: schema.vendorContacts.name,
      email: schema.vendorContacts.email,
    })
    .from(schema.vendorContacts)
    .where(
      and(
        inArray(schema.vendorContacts.vendorId, vendorIds),
        eq(schema.vendorContacts.active, true),
      ),
    )
    // Stable and meaningful: the contact added first is the one a person would
    // name as the vendor's main contact.
    .orderBy(asc(schema.vendorContacts.id));

  const byVendor = new Map<number, { name: string | null; email: string | null }[]>();
  for (const r of rows) {
    const list = byVendor.get(r.vendorId) ?? [];
    list.push({ name: r.name, email: r.email });
    byVendor.set(r.vendorId, list);
  }

  for (const [vendorId, list] of byVendor) {
    const picked = pickContact(list);
    if (picked) out.set(vendorId, picked);
  }
  return out;
}
