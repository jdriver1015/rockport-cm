import Link from "next/link";
import { asc, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";
import { AddTemplateDialog, TemplateRowActions } from "@/components/budget-template-list";
import { InteriorDefaultsPanel } from "@/components/interior-defaults-panel";
import { TemplateSeedToggle } from "@/components/template-seed-toggle";
import { readInteriorDefaults, readScheduleDefaults } from "@/lib/interior-defaults";
import { ScheduleDefaultsPanel } from "@/components/schedule-defaults-panel";

export const dynamic = "force-dynamic";

export default async function BudgetTemplatesPage() {
  const templates = await db()
    .select()
    .from(schema.budgetTemplates)
    .where(isNull(schema.budgetTemplates.archivedAt))
    .orderBy(asc(schema.budgetTemplates.sortOrder), asc(schema.budgetTemplates.name));

  const [defaults, schedule] = await Promise.all([
    readInteriorDefaults(),
    readScheduleDefaults(),
  ]);

  const lineCounts = await db()
    .select({
      templateId: schema.budgetTemplateLines.templateId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.budgetTemplateLines)
    .groupBy(schema.budgetTemplateLines.templateId);
  const linesByTemplate = new Map(lineCounts.map((c) => [c.templateId, c.count]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {templates.length} renovation type{templates.length === 1 ? "" : "s"} · the ones marked{" "}
          <span className="font-medium text-navy">Default</span> arrive pre-checked when a property
          is created
        </p>
        <AddTemplateDialog />
      </div>

      <Card>
        <CardContent className="divide-y p-0">
          {templates.map((t) => {
            const lines = linesByTemplate.get(t.id) ?? 0;
            return (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                <Link
                  href={`/settings/renovation-types/${t.id}`}
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
                  {lines} line{lines === 1 ? "" : "s"}
                </span>
                <TemplateSeedToggle
                  templateId={t.id}
                  name={t.name}
                  seedByDefault={t.seedByDefault}
                />
                <TemplateRowActions id={t.id} name={t.name} description={t.description} />
                <Link href={`/settings/renovation-types/${t.id}`}>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              </div>
            );
          })}
          {templates.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No templates yet. Add one to define a standard renovation budget.
            </p>
          )}
        </CardContent>
      </Card>

      <InteriorDefaultsPanel defaults={defaults} />

      <ScheduleDefaultsPanel schedule={schedule} />
    </div>
  );
}
