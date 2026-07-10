import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Links a real Supabase auth user to a `profiles` row. If an admin
 * pre-provisioned a roster entry for this email (via Settings → Users) it's
 * adopted — keeping its role — and re-keyed to the real auth id, since the
 * roster entry was created with a placeholder id. Otherwise a fresh profile
 * is created with the default "viewer" role.
 */
export async function ensureProfile(userId: string, email: string, fullName?: string | null) {
  const byId = await db().query.profiles.findFirst({ where: eq(schema.profiles.id, userId) });
  if (byId) return;

  const normalizedEmail = email.toLowerCase();
  const byEmail = await db().query.profiles.findFirst({
    where: eq(schema.profiles.email, normalizedEmail),
  });

  if (byEmail) {
    await db().delete(schema.profiles).where(eq(schema.profiles.id, byEmail.id));
    await db()
      .insert(schema.profiles)
      .values({
        id: userId,
        email: normalizedEmail,
        fullName: fullName ?? byEmail.fullName,
        role: byEmail.role,
      });
    return;
  }

  await db().insert(schema.profiles).values({
    id: userId,
    email: normalizedEmail,
    fullName,
    role: "viewer",
  });
}
