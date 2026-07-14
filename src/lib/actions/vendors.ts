"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { ActionResult } from "@/lib/action-result";

// Vendors are portfolio-wide; revalidate every property's vendors tab via the
// dynamic segment plus the pages that render vendor names.
function revalidateVendors(propertyId: number) {
  revalidatePath(`/properties/${propertyId}/vendors`);
  revalidatePath(`/properties/${propertyId}`);
}

const vendorSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Vendor name is required"),
  trade: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  // Optional first contact, created inline with the vendor
  contactName: z.string().trim().optional(),
  contactTitle: z.string().trim().optional(),
  contactEmail: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  contactPhone: z.string().trim().optional(),
});

export async function createVendor(formData: FormData): Promise<ActionResult<{ vendorId: number }>> {
  const parsed = vendorSchema.safeParse({
    propertyId: formData.get("propertyId"),
    name: formData.get("name"),
    trade: formData.get("trade") || undefined,
    notes: formData.get("notes") || undefined,
    contactName: formData.get("contactName") || undefined,
    contactTitle: formData.get("contactTitle") || undefined,
    contactEmail: formData.get("contactEmail") || undefined,
    contactPhone: formData.get("contactPhone") || undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const existing = await db().query.vendors.findFirst({
    where: eq(schema.vendors.name, d.name),
  });
  if (existing) return { ok: false, error: `Vendor "${d.name}" already exists` };

  const email = d.contactEmail || undefined;
  if (email) {
    const emailTaken = await db().query.vendorContacts.findFirst({
      where: eq(schema.vendorContacts.email, email),
    });
    if (emailTaken) return { ok: false, error: `A contact with ${email} already exists` };
  }

  const [vendor] = await db()
    .insert(schema.vendors)
    .values({ name: d.name, trade: d.trade, notes: d.notes })
    .returning();

  if (d.contactName) {
    await db().insert(schema.vendorContacts).values({
      vendorId: vendor.id,
      name: d.contactName,
      title: d.contactTitle,
      email,
      phone: d.contactPhone,
      isPrimary: true,
    });
  }

  revalidateVendors(d.propertyId);
  return { ok: true, vendorId: vendor.id };
}

export async function updateVendor(input: {
  id: number;
  propertyId: number;
  name?: string;
  trade?: string;
  notes?: string;
}): Promise<ActionResult> {
  const name = input.name?.trim();
  if (name !== undefined && !name) return { ok: false, error: "Vendor name is required" };

  if (name) {
    const clash = await db().query.vendors.findFirst({
      where: and(eq(schema.vendors.name, name), ne(schema.vendors.id, input.id)),
    });
    if (clash) return { ok: false, error: `Vendor "${name}" already exists` };
  }

  await db()
    .update(schema.vendors)
    .set({
      ...(name !== undefined ? { name } : {}),
      ...(input.trade !== undefined ? { trade: input.trade.trim() || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}),
    })
    .where(eq(schema.vendors.id, input.id));

  revalidateVendors(input.propertyId);
  return { ok: true };
}

export async function setVendorActive(input: {
  id: number;
  propertyId: number;
  active: boolean;
}): Promise<ActionResult> {
  await db()
    .update(schema.vendors)
    .set({ active: input.active })
    .where(eq(schema.vendors.id, input.id));
  revalidateVendors(input.propertyId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

const contactSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  vendorId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Contact name is required"),
  title: z.string().trim().optional(),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  phone: z.string().trim().optional(),
});

export async function addContact(formData: FormData): Promise<ActionResult> {
  const parsed = contactSchema.safeParse({
    propertyId: formData.get("propertyId"),
    vendorId: formData.get("vendorId"),
    name: formData.get("name"),
    title: formData.get("title") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const email = d.email || undefined;
  if (email) {
    const emailTaken = await db().query.vendorContacts.findFirst({
      where: eq(schema.vendorContacts.email, email),
    });
    if (emailTaken) return { ok: false, error: `A contact with ${email} already exists` };
  }

  // First contact on a vendor becomes primary automatically
  const [{ count }] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.vendorContacts)
    .where(eq(schema.vendorContacts.vendorId, d.vendorId));

  await db().insert(schema.vendorContacts).values({
    vendorId: d.vendorId,
    name: d.name,
    title: d.title,
    email,
    phone: d.phone,
    isPrimary: count === 0,
  });

  revalidateVendors(d.propertyId);
  return { ok: true };
}

export async function updateContact(input: {
  id: number;
  propertyId: number;
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
}): Promise<ActionResult> {
  const name = input.name?.trim();
  if (name !== undefined && !name) return { ok: false, error: "Contact name is required" };

  const email = input.email?.trim() || undefined;
  if (email) {
    const emailTaken = await db().query.vendorContacts.findFirst({
      where: and(eq(schema.vendorContacts.email, email), ne(schema.vendorContacts.id, input.id)),
    });
    if (emailTaken) return { ok: false, error: `A contact with ${email} already exists` };
  }

  await db()
    .update(schema.vendorContacts)
    .set({
      ...(name !== undefined ? { name } : {}),
      ...(input.title !== undefined ? { title: input.title.trim() || null } : {}),
      ...(input.email !== undefined ? { email: email ?? null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone.trim() || null } : {}),
    })
    .where(eq(schema.vendorContacts.id, input.id));

  revalidateVendors(input.propertyId);
  return { ok: true };
}

export async function setContactPrimary(input: {
  id: number;
  propertyId: number;
}): Promise<ActionResult> {
  const contact = await db().query.vendorContacts.findFirst({
    where: eq(schema.vendorContacts.id, input.id),
  });
  if (!contact) return { ok: false, error: "Contact not found" };

  await db().transaction(async (tx) => {
    await tx
      .update(schema.vendorContacts)
      .set({ isPrimary: false })
      .where(eq(schema.vendorContacts.vendorId, contact.vendorId));
    await tx
      .update(schema.vendorContacts)
      .set({ isPrimary: true })
      .where(eq(schema.vendorContacts.id, input.id));
  });

  revalidateVendors(input.propertyId);
  return { ok: true };
}

export async function setContactActive(input: {
  id: number;
  propertyId: number;
  active: boolean;
}): Promise<ActionResult> {
  await db()
    .update(schema.vendorContacts)
    .set({ active: input.active, ...(input.active ? {} : { isPrimary: false }) })
    .where(eq(schema.vendorContacts.id, input.id));
  revalidateVendors(input.propertyId);
  return { ok: true };
}
