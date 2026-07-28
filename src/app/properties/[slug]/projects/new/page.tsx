import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewProjectForm } from "@/components/new-project-form";

export const dynamic = "force-dynamic";

export default async function NewProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.slug, slug),
  });
  if (!property) notFound();

  const codes = await db()
    .select({
      id: schema.costCodes.id,
      code: schema.costCodes.code,
      name: schema.costCodes.name,
      isInterior: schema.costCodes.isInterior,
    })
    .from(schema.costCodes)
    .where(and(eq(schema.costCodes.chartId, property.chartOfAccountsId), eq(schema.costCodes.active, true)))
    .orderBy(asc(schema.costCodes.code));

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-navy">New project — {property.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <NewProjectForm
            propertyId={property.id}
            propertySlug={property.slug}
            costCodes={codes.filter((c) => !c.isInterior)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
