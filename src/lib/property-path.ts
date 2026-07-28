import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { projectSlug } from "@/lib/slug";

/**
 * Resolves a property id to its slug-based path, for building revalidatePath
 * targets after a mutation. Server-only — never import from a client component.
 */
export async function propertyPath(propertyId: number, suffix = ""): Promise<string | null> {
  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.id, propertyId),
    columns: { slug: true },
  });
  return property ? `/properties/${property.slug}${suffix}` : null;
}

/** Same, but for a project detail path — needs the project's name for its id-prefixed slug. */
export async function propertyProjectPath(propertyId: number, projectId: number): Promise<string | null> {
  const [property, project] = await Promise.all([
    db().query.properties.findFirst({ where: eq(schema.properties.id, propertyId), columns: { slug: true } }),
    db().query.projects.findFirst({ where: eq(schema.projects.id, projectId), columns: { id: true, name: true } }),
  ]);
  if (!property || !project) return null;
  return `/properties/${property.slug}/projects/${projectSlug(project)}`;
}
