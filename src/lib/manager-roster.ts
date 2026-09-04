import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { MANAGER_ROLES, managerName, type ManagerOption } from "@/lib/project-managers";

/**
 * The roster reads. Server-only — see the note in project-managers.ts about why
 * these are not in the same file as the display helpers.
 */

/**
 * The assignable roster, for the board's picker and the project edit dialog.
 *
 * Archived profiles are excluded — a departed person must not be assignable to
 * new work. They are NOT excluded from being *displayed*: a project they still
 * hold keeps their name, which the board reads off its own join rather than by
 * looking the id up in here. Two different questions, two different answers.
 */
export async function readManagerRoster(): Promise<ManagerOption[]> {
  const rows = await db()
    .select({
      id: schema.profiles.id,
      fullName: schema.profiles.fullName,
      email: schema.profiles.email,
    })
    .from(schema.profiles)
    .where(
      and(isNull(schema.profiles.archivedAt), inArray(schema.profiles.role, [...MANAGER_ROLES])),
    )
    .orderBy(asc(schema.profiles.fullName), asc(schema.profiles.email));

  return rows.map((r) => ({
    id: r.id,
    name: managerName(r.fullName, r.email),
    email: r.email,
  }));
}

/**
 * Whether this profile may be assigned right now.
 *
 * The server action's guard. The picker only offers the roster, so reaching this
 * with anything else means a hand-made request — the reason it re-checks the
 * role and the archive flag rather than trusting the id it was handed.
 */
export async function isAssignableManager(profileId: string): Promise<boolean> {
  const row = await db().query.profiles.findFirst({
    where: and(
      eq(schema.profiles.id, profileId),
      isNull(schema.profiles.archivedAt),
      inArray(schema.profiles.role, [...MANAGER_ROLES]),
    ),
    columns: { id: true },
  });
  return !!row;
}
