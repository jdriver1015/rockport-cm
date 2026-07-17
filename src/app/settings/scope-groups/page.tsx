import Link from "next/link";
import { asc, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";
import { AddTemplateDialog, TemplateRowActions } from "@/components/scope-template-list";

export const dynamic = "force-dynamic";

export default async function ScopeGroupsPage() {
  const templates = await db()
    .select()
    .from(schema.scopeGroupTemplates)
    .where(isNull(schema.scopeGroupTemplates.archivedAt))
    .orderBy(asc(schema.scopeGroupTemplates.sortOrder), asc(schema.scopeGroupTemplates.name));

  const itemCounts = await db()
    .select({
      templateId: schema.scopeGroupTemplateItems.templateId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.scopeGroupTemplateItems)
    .groupBy(schema.scopeGroupTemplateItems.templateId);
  const itemsByTemplate = new Map(itemCounts.map((c) => [c.templateId, c.count]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {templates.length} renovation template{templates.length === 1 ? "" : "s"} · base options for
          per-property scope groups
        </p>
        <AddTemplateDialog />
      </div>

      <Card>
        <CardContent className="divide-y p-0">
          {templates.map((t) => {
            const items = itemsByTemplate.get(t.id) ?? 0;
            return (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                <Link
                  href={`/settings/scope-groups/${t.id}`}
                  className="group flex min-w-0 flex-1 items-center gap-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-navy group-hover:underline">
                        {t.name}
                      </span>
                      {!t.active && <Badge variant="outline">Inactive</Badge>}
                    </div>
                    {t.description && (
                      <p className="truncate text-xs text-muted-foreground">{t.description}</p>
                    )}
                  </div>
                </Link>
                <span className="hidden shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:inline">
                  {items} item{items === 1 ? "" : "s"}
                </span>
                <TemplateRowActions id={t.id} name={t.name} description={t.description} />
                <Link href={`/settings/scope-groups/${t.id}`}>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              </div>
            );
          })}
          {templates.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No templates yet. Add one to define a standard renovation package.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
