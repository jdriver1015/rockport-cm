import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PropertyHeader } from "@/components/property-header";
import { PropertyNav } from "@/components/property-nav";
import { InteriorNav } from "@/components/interior-nav";
import { TriggerRuleEditor, type TypeOption } from "@/components/trigger-rule-editor";
import { listTriggerSteps } from "@/lib/renovation-triggers-store";

export const dynamic = "force-dynamic";

export default async function TriggersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.slug, slug),
  });
  if (!property) notFound();

  const [steps, groups] = await Promise.all([
    listTriggerSteps(property.id),
    db()
      .select({ id: schema.budgetGroups.id, name: schema.budgetGroups.name })
      .from(schema.budgetGroups)
      .where(
        and(
          eq(schema.budgetGroups.propertyId, property.id),
          isNull(schema.budgetGroups.archivedAt),
        ),
      )
      .orderBy(asc(schema.budgetGroups.sortOrder), asc(schema.budgetGroups.name)),
  ]);

  const types: TypeOption[] = groups;

  return (
    <div className="space-y-6">
      <PropertyHeader property={property} />
      <PropertyNav slug={property.slug} />
      <InteriorNav slug={property.slug} />

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground">
          Portfolio
        </Link>
        <span className="text-ink-100">/</span>
        <Link href={`/properties/${slug}`} className="hover:text-foreground">
          {property.name}
        </Link>
        <span className="text-ink-100">/</span>
        <span className="font-semibold text-navy">Reno type triggers</span>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-baseline justify-between gap-3">
          <CardTitle className="text-base text-navy">Unit reno type triggers</CardTitle>
          <span className="text-sm text-muted-foreground">
            Property-level, not per type — this is what decides between them.
          </span>
        </CardHeader>
        <CardContent className="px-0">
          <TriggerRuleEditor propertyId={property.id} steps={steps} types={types} />
        </CardContent>
      </Card>
    </div>
  );
}
