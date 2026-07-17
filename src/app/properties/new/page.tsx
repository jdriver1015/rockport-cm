import { asc, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewPropertyForm } from "@/components/new-property-form";

export const dynamic = "force-dynamic";

export default async function NewPropertyPage() {
  const charts = await db()
    .select({
      id: schema.chartsOfAccounts.id,
      name: schema.chartsOfAccounts.name,
      isDefault: schema.chartsOfAccounts.isDefault,
    })
    .from(schema.chartsOfAccounts)
    .where(isNull(schema.chartsOfAccounts.archivedAt))
    .orderBy(asc(schema.chartsOfAccounts.name));

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-navy">New property</CardTitle>
        </CardHeader>
        <CardContent>
          <NewPropertyForm charts={charts} />
        </CardContent>
      </Card>
    </div>
  );
}
