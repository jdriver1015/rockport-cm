import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Link a signed-in Supabase auth user to their roster row, and say whether they
 * have one.
 *
 * Access is by invitation: an admin adds a person in Settings → Users, which
 * creates the auth user with the roster row's own id, so the normal case is a
 * match by id. The email fallback adopts a roster row added before invitations
 * existed, when the person already had an auth account under a different id —
 * it keeps the row's role and re-keys it to the real auth id.
 *
 * Nobody is given a profile they were not invited to. This used to create a
 * default "viewer" for any auth user it had not seen, which let anyone who
 * could create a Supabase account read the whole portfolio. An archived row is
 * never adopted either — that would silently restore a removed person.
 *
 * Returns the user's active roster row, or null when they have none — not
 * invited, or removed.
 */
export async function ensureProfile(
  userId: string,
  email: string,
  fullName?: string | null,
): Promise<typeof schema.profiles.$inferSelect | null> {
  const byId = await db().query.profiles.findFirst({ where: eq(schema.profiles.id, userId) });
  if (byId) return byId.archivedAt == null ? byId : null;

  const normalizedEmail = email.toLowerCase();
  const byEmail = await db().query.profiles.findFirst({
    where: and(eq(schema.profiles.email, normalizedEmail), isNull(schema.profiles.archivedAt)),
  });
  if (!byEmail) return null;

  await db().delete(schema.profiles).where(eq(schema.profiles.id, byEmail.id));
  const [adopted] = await db()
    .insert(schema.profiles)
    .values({
      id: userId,
      email: normalizedEmail,
      fullName: fullName ?? byEmail.fullName,
      role: byEmail.role,
    })
    .returning();
  return adopted;
}
