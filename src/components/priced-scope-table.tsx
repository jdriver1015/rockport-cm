import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableGroupRow,
  TableHead,
  TableHeader,
  TableRow,
  TableSpacerRow,
} from "@/components/ui/table";
import { ScopeStatusSelect } from "@/components/scope-status-select";
import { PRICING_METHOD_LABELS, type PricingMethod } from "@/lib/pricing";
import { groupScopeByCategory } from "@/lib/scope-grouping";
import { money } from "@/lib/format";

export type PricedScopeRow = {
  id: number;
  item: string;
  materialQuality: string | null;
  category: string | null;
  status: string;
  pricingMethod: PricingMethod | null;
  unitPrice: string | null;
  quantity: string | null;
  costCode: string | null;
};

const COLS = 7;

const exact = (v: number) =>
  `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Scope view for interior projects generated from a scope group. Lines are
 * grouped by trade so each band carries its own progress rollup, and status is
 * editable inline — the pricing itself stays read-only (it came from the
 * estimate and its sum seeded the budget).
 */
export function PricedScopeTable({
  items,
  propertyId,
  projectId,
}: {
  items: PricedScopeRow[];
  propertyId: number;
  projectId: number;
}) {
  const lineTotal = (r: PricedScopeRow) =>
    r.quantity != null && r.unitPrice != null ? Number(r.quantity) * Number(r.unitPrice) : 0;
  const total = items.reduce((s, r) => s + lineTotal(r), 0);

  const groups = groupScopeByCategory(
    items.map((r) => ({
      ...r,
      quantity: r.quantity != null ? Number(r.quantity) : null,
      unitPrice: r.unitPrice != null ? Number(r.unitPrice) : null,
      row: r,
    })),
  );

  const completeValue = groups.reduce((s, g) => s + g.progress.completeValue, 0);
  const pct = total > 0 ? Math.round((completeValue / total) * 100) : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base text-navy">Scope &amp; estimate</CardTitle>
        <span className="text-sm text-muted-foreground tabular-nums">
          {money(completeValue)} of {money(total)} complete · {pct}%
        </span>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Item</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Cost code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.flatMap((g, gi) => [
                ...(gi > 0 ? [<TableSpacerRow key={`sp-${g.label}`} colSpan={COLS} />] : []),
                <TableGroupRow
                  key={`g-${g.label}`}
                  label={g.label}
                  count={`${g.progress.complete} of ${g.progress.total} complete`}
                  colSpan={COLS}
                />,
                ...g.lines.map(({ row: r }) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-normal">
                      <div className="font-medium text-navy">{r.item}</div>
                      {r.materialQuality && (
                        <div className="text-xs text-muted-foreground">{r.materialQuality}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.pricingMethod ? PRICING_METHOD_LABELS[r.pricingMethod] : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.costCode ?? "—"}
                    </TableCell>
                    <TableCell>
                      <ScopeStatusSelect
                        id={r.id}
                        propertyId={propertyId}
                        projectId={projectId}
                        status={r.status}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.quantity != null ? Number(r.quantity).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.unitPrice != null ? exact(Number(r.unitPrice)) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{exact(lineTotal(r))}</TableCell>
                  </TableRow>
                )),
              ])}
            </TableBody>
          </Table>
        </div>
        <div className="mt-3 flex items-center justify-between border-t pt-3 text-sm font-semibold text-navy">
          <span>Estimated total</span>
          <span className="tabular-nums">{exact(total)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
