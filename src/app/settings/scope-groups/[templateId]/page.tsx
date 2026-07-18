import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeft, ExternalLink } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableGroupRow,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SCOPE_SECTIONS } from "@/lib/scope-sections";
import {
  AddTemplateItemDialog,
  EditTemplateItemDialog,
  type InteriorCodeOption,
  type TemplateItem,
} from "@/components/scope-template-editor";

export const dynamic = "force-dynamic";

type ItemRow = typeof schema.scopeGroupTemplateItems.$inferSelect;

function toEditable(it: ItemRow): TemplateItem {
  return {
    id: it.id,
    name: it.name,
    category: it.category,
    isAlternate: it.isAlternate,
    location: it.location,
    productLink: it.productLink,
    costCodeRef: it.costCodeRef,
    materialAssumptions: it.materialAssumptions,
    notes: it.notes,
  };
}

/** Group items by trade section in the standard Exhibit-A order. */
function groupBySection(items: ItemRow[]): [string, ItemRow[]][] {
  const order = new Map<string, number>(SCOPE_SECTIONS.map((s, i) => [s, i]));
  const groups = new Map<string, ItemRow[]>();
  for (const it of items) {
    const key = it.category ?? "Uncategorized";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(it);
  }
  return [...groups.entries()].sort(
    ([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b),
  );
}

function ScopeLinesTable({
  templateId,
  items,
  interiorCodes,
  grouped,
}: {
  templateId: number;
  items: ItemRow[];
  interiorCodes: InteriorCodeOption[];
  grouped: boolean;
}) {
  const sections = grouped ? groupBySection(items) : [["", items] as [string, ItemRow[]]];
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-2/5">Scope of work</TableHead>
          <TableHead>Location</TableHead>
          <TableHead className="w-1/3">Standard material</TableHead>
          <TableHead className="text-right">Edit</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sections.map(([section, rows]) => (
          <SectionRows
            key={section || "all"}
            templateId={templateId}
            section={grouped ? section : null}
            rows={rows}
            interiorCodes={interiorCodes}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function SectionRows({
  templateId,
  section,
  rows,
  interiorCodes,
}: {
  templateId: number;
  section: string | null;
  rows: ItemRow[];
  interiorCodes: InteriorCodeOption[];
}) {
  return (
    <>
      {section && <TableGroupRow label={section} count={rows.length} colSpan={4} />}
      {rows.map((it) => (
        <TableRow key={it.id} className={it.active ? undefined : "opacity-55"}>
          <TableCell className="whitespace-normal align-top">
            <span className="font-medium text-text">{it.name}</span>
            {it.notes && <p className="mt-0.5 text-xs text-text-faint">{it.notes}</p>}
          </TableCell>
          <TableCell className="align-top text-sm text-muted-foreground">
            {it.location ?? "—"}
          </TableCell>
          <TableCell className="whitespace-normal align-top text-sm text-text-body">
            {it.materialAssumptions ?? "—"}
            {it.productLink && (
              <a
                href={it.productLink}
                target="_blank"
                rel="noreferrer"
                className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-gold-link hover:underline"
              >
                spec
                <ExternalLink className="size-3" />
              </a>
            )}
          </TableCell>
          <TableCell className="align-top text-right">
            <EditTemplateItemDialog
              templateId={templateId}
              item={toEditable(it)}
              interiorCodes={interiorCodes}
            />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

export default async function ScopeTemplateEditorPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId: templateIdParam } = await params;
  const templateId = Number(templateIdParam);
  if (!Number.isInteger(templateId)) notFound();

  const template = await db().query.scopeGroupTemplates.findFirst({
    where: eq(schema.scopeGroupTemplates.id, templateId),
  });
  if (!template) notFound();

  const items = await db()
    .select()
    .from(schema.scopeGroupTemplateItems)
    .where(eq(schema.scopeGroupTemplateItems.templateId, templateId))
    .orderBy(asc(schema.scopeGroupTemplateItems.sortOrder), asc(schema.scopeGroupTemplateItems.id));

  const baseItems = items.filter((it) => !it.isAlternate);
  const alternates = items.filter((it) => it.isAlternate);

  // Suggest 4000-series interior codes from the default chart (templates store
  // the code as a string, resolved to each property's chart when instantiated).
  const defaultChart = await db().query.chartsOfAccounts.findFirst({
    where: eq(schema.chartsOfAccounts.isDefault, true),
  });
  const interiorCodes: InteriorCodeOption[] = defaultChart
    ? await db()
        .select({ code: schema.costCodes.code, name: schema.costCodes.name })
        .from(schema.costCodes)
        .where(and(eq(schema.costCodes.chartId, defaultChart.id), eq(schema.costCodes.isInterior, true)))
        .orderBy(asc(schema.costCodes.code))
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/settings/scope-groups"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" /> All scope groups
          </Link>
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-navy">{template.name}</h2>
            {!template.active && <Badge variant="outline">Inactive</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {baseItems.length} scope line{baseItems.length === 1 ? "" : "s"}
            {alternates.length > 0 &&
              ` · ${alternates.length} alternate${alternates.length === 1 ? "" : "s"}`}
            {" · pricing is set per project, not here"}
          </p>
        </div>
        <AddTemplateItemDialog templateId={templateId} interiorCodes={interiorCodes} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">Base scope of work</CardTitle>
        </CardHeader>
        <CardContent>
          {baseItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No scope lines yet. Add the standard work lines for this tier (e.g. “R&R kitchen
              faucet.”).
            </p>
          ) : (
            <ScopeLinesTable
              templateId={templateId}
              items={baseItems}
              interiorCodes={interiorCodes}
              grouped
            />
          )}
        </CardContent>
      </Card>

      {alternates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-navy">Add / Deduct Alternatives</CardTitle>
            <p className="text-xs text-muted-foreground">
              Optional lines quoted separately on each project.
            </p>
          </CardHeader>
          <CardContent>
            <ScopeLinesTable
              templateId={templateId}
              items={alternates}
              interiorCodes={interiorCodes}
              grouped={false}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
