import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PropertyHeader } from "@/components/property-header";
import { PropertyNav } from "@/components/property-nav";
import { AddAuditDialog } from "@/components/add-audit-dialog";
import { SiteAuditsTable } from "@/components/site-audits-table";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AuditsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.slug, slug),
  });
  if (!property) notFound();
  const propertyId = property.id;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user
    ? await db().query.profiles.findFirst({ where: eq(schema.profiles.id, user.id) })
    : null;

  const [audits, findingCounts, archivedCount, projects] = await Promise.all([
    db()
      .select()
      .from(schema.siteAudits)
      .where(and(eq(schema.siteAudits.propertyId, propertyId), isNull(schema.siteAudits.archivedAt)))
      .orderBy(desc(schema.siteAudits.auditDate), desc(schema.siteAudits.id)),
    db()
      .select({
        auditId: schema.auditFindings.auditId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.auditFindings)
      .where(isNull(schema.auditFindings.archivedAt))
      .groupBy(schema.auditFindings.auditId),
    db().$count(
      schema.siteAudits,
      and(eq(schema.siteAudits.propertyId, propertyId), isNotNull(schema.siteAudits.archivedAt)),
    ),
    db()
      .select({ id: schema.projects.id, name: schema.projects.name })
      .from(schema.projects)
      .where(and(eq(schema.projects.propertyId, propertyId), isNull(schema.projects.archivedAt)))
      .orderBy(schema.projects.name),
  ]);

  const findingsByAudit = new Map(findingCounts.map((r) => [r.auditId, r.count]));

  return (
    <div className="space-y-6">
      <PropertyHeader property={property} />

      <PropertyNav slug={property.slug} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base text-navy">Site Audits</CardTitle>
          <div className="flex items-center gap-3">
            {archivedCount > 0 && (
              <Link
                href={`/properties/${slug}/audits/archived`}
                className="text-sm text-link hover:underline"
              >
                Archived ({archivedCount})
              </Link>
            )}
            <AddAuditDialog
              propertyId={property.id}
              propertySlug={property.slug}
              defaultAuditor={profile?.fullName ?? null}
              projects={projects}
            />
          </div>
        </CardHeader>
        <CardContent>
          <SiteAuditsTable propertySlug={slug} audits={audits} findingsByAudit={findingsByAudit} />
        </CardContent>
      </Card>
    </div>
  );
}
