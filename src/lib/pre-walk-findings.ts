import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";

// ---------------------------------------------------------------------------
// Reads over a project's pre-walk. Kept out of the actions module so a read is
// a function the page calls rather than an endpoint of its own.
// ---------------------------------------------------------------------------
/** The pre-walk's findings, flagged with whether each is already scope. */
export async function listPreWalkFindings(projectId: number) {
  const rows = await db()
    .select({
      id: schema.auditFindings.id,
      title: schema.auditFindings.title,
      description: schema.auditFindings.description,
      severity: schema.auditFindings.severity,
      location: schema.auditFindings.location,
    })
    .from(schema.auditFindings)
    .innerJoin(schema.siteAudits, eq(schema.siteAudits.id, schema.auditFindings.auditId))
    .where(
      and(
        eq(schema.siteAudits.projectId, projectId),
        eq(schema.siteAudits.kind, "pre_walk"),
        isNull(schema.siteAudits.archivedAt),
        isNull(schema.auditFindings.archivedAt),
      ),
    )
    .orderBy(asc(schema.auditFindings.id));
  if (rows.length === 0) return [];

  const taken = await db()
    .select({ sourceFindingId: schema.scopeItems.sourceFindingId })
    .from(schema.scopeItems)
    .where(and(eq(schema.scopeItems.projectId, projectId), isNull(schema.scopeItems.archivedAt)));
  const already = new Set(taken.map((t) => t.sourceFindingId).filter((v): v is number => v != null));

  return rows.map((r) => ({ ...r, inScope: already.has(r.id) }));
}

/**
 * Turn pre-walk findings into scope lines.
 *
 * The join the pre-walk-first ordering exists for: you walk the unit, record
 * what you found, and the scope is written from those findings rather than from
 * memory. The finding's title becomes the line and its description the material
 * note. Nothing is priced — a line's cost comes from the bid, and a number
 * invented here would read as an estimate somebody made.
 *
 * A plain function rather than the action itself, so it can be exercised without
 * a request: the action wraps it and revalidates.
 */
export async function importFindingsToScopeRows(
  projectId: number,
  findingIds: number[],
): Promise<{ ok: true; added: number; skipped: number } | { ok: false; error: string }> {
  const project = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { propertyId: true },
  });
  if (!project) return { ok: false, error: "Project not found" };

  // Only findings on THIS project's pre-walk. Without the join a caller could
  // pass any finding id in the database and have it become scope here.
  const findings = await db()
    .select({
      id: schema.auditFindings.id,
      title: schema.auditFindings.title,
      description: schema.auditFindings.description,
    })
    .from(schema.auditFindings)
    .innerJoin(schema.siteAudits, eq(schema.siteAudits.id, schema.auditFindings.auditId))
    .where(
      and(
        eq(schema.siteAudits.projectId, projectId),
        eq(schema.siteAudits.kind, "pre_walk"),
        isNull(schema.siteAudits.archivedAt),
        isNull(schema.auditFindings.archivedAt),
        inArray(schema.auditFindings.id, findingIds),
      ),
    );
  if (findings.length === 0) {
    return { ok: false, error: "Those findings aren't on this project's pre-walk" };
  }

  // Already-imported findings are skipped rather than duplicated, so pressing
  // import twice does not double the scope.
  const taken = await db()
    .select({ sourceFindingId: schema.scopeItems.sourceFindingId })
    .from(schema.scopeItems)
    .where(
      and(
        eq(schema.scopeItems.projectId, projectId),
        isNull(schema.scopeItems.archivedAt),
        inArray(
          schema.scopeItems.sourceFindingId,
          findings.map((f) => f.id),
        ),
      ),
    );
  const already = new Set(taken.map((t) => t.sourceFindingId));
  const fresh = findings.filter((f) => !already.has(f.id));
  if (fresh.length === 0) {
    return { ok: true, added: 0, skipped: findings.length };
  }

  const [{ maxOrder }] = await db()
    .select({ maxOrder: sql<number>`coalesce(max(${schema.scopeItems.sortOrder}), -1)::int` })
    .from(schema.scopeItems)
    .where(eq(schema.scopeItems.projectId, projectId));

  await db()
    .insert(schema.scopeItems)
    .values(
      fresh.map((f, i) => ({
        projectId,
        item: f.title,
        materialQuality: f.description,
        sourceFindingId: f.id,
        sortOrder: maxOrder + 1 + i,
      })),
    );

  return { ok: true, added: fresh.length, skipped: findings.length - fresh.length };
}
