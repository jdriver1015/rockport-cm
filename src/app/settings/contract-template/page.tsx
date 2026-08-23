import { asc, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent } from "@/components/ui/card";
import { ContractTemplateEditor } from "@/components/contract-template-editor";

export const dynamic = "force-dynamic";

export default async function ContractTemplatePage() {
  const templates = await db()
    .select({
      id: schema.contractTemplates.id,
      name: schema.contractTemplates.name,
      body: schema.contractTemplates.body,
      isDefault: schema.contractTemplates.isDefault,
      version: schema.contractTemplates.version,
      updatedAt: schema.contractTemplates.updatedAt,
    })
    .from(schema.contractTemplates)
    .where(isNull(schema.contractTemplates.archivedAt))
    .orderBy(asc(schema.contractTemplates.id));

  return (
    <Card>
      <CardContent>
        <ContractTemplateEditor
          templates={templates.map((t) => ({ ...t, updatedAt: t.updatedAt.toISOString() }))}
        />
      </CardContent>
    </Card>
  );
}
