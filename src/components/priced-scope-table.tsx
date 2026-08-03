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
import { LineActualButton, type LineTxn } from "@/components/line-transactions-dialog";
import { PRICING_METHOD_LABELS, type PricingMethod } from "@/lib/pricing";
import { groupScopeByCategory } from "@/lib/scope-grouping";
import { cn } from "@/lib/utils";
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
  costCodeId: number | null;
};

const COLS = 8;

const exact = (v: number) =>
  `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PricedScopeTable({
  items,
  transactionsByCode,
}: {
  items: PricedScopeRow[];
  transactionsByCode: Record<number, LineTxn[]>;
}) {
  const lineTotal = (r: PricedScopeRow) =>
    r.quantity != null && r.unitPrice != null ? Number(r.quantity) * Number(r.unitPrice) : 0;
  const total = items.reduce((s, r) => s + lineTotal(r), 0);

  const actualForCode = (codeId: number | null): number => {
    if (codeId == null) return 0;
    const txns = transactionsByCode[codeId];
    if (!txns) return 0;
    return txns.reduce((s, t) => s + Number(t.amount), 0);
  };

  const usedCodes = new Set<number>();
  let totalActual = 0;
  for (const r of items) {
    if (r.costCodeId == null || usedCodes.has(r.costCodeId)) continue;
    usedCodes.add(r.costCodeId);
    totalActual += actualForCode(r.costCodeId);
  }
  const totalVariance = total - totalActual;

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

  const groupActual = (g: (typeof groups)[number]): number => {
    const seen = new Set<number>();
    let sum = 0;
    for (const line of g.lines) {
      const id = line.row.costCodeId;
      if (id == null || seen.has(id)) continue;
      seen.add(id);
      sum += actualForCode(id);
    }
    return sum;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base text-navy">Scope &amp; cost</CardTitle>
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
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Estimated</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.flatMap((g, gi) => {
                const gEst = g.lines.reduce(
                  (s, l) =>
                    s +
                    (l.quantity != null && l.unitPrice != null ? l.quantity * l.unitPrice : 0),
                  0,
                );
                const gActual = groupActual(g);
                return [
                  ...(gi > 0 ? [<TableSpacerRow key={`sp-${g.label}`} colSpan={COLS} />] : []),
                  <TableGroupRow
                    key={`g-${g.label}`}
                    label={g.label}
                    count={`${g.progress.complete} of ${g.progress.total} complete · ${money(gActual)} actual of ${money(gEst)}`}
                    colSpan={COLS}
                  />,
                  ...g.lines.map(({ row: r }) => {
                    const est = lineTotal(r);
                    const actual = actualForCode(r.costCodeId);
                    const variance = est - actual;
                    return (
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
                        <TableCell className="text-right tabular-nums">
                          {r.quantity != null ? Number(r.quantity).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.unitPrice != null ? exact(Number(r.unitPrice)) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{exact(est)}</TableCell>
                        <TableCell>
                          <LineActualButton
                            label={r.costCode ? `${r.item} — ${r.costCode}` : r.item}
                            amount={actual}
                            transactions={
                              r.costCodeId != null
                                ? transactionsByCode[r.costCodeId] ?? []
                                : []
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <VarianceCell value={variance} hasActual={actual > 0} />
                        </TableCell>
                      </TableRow>
                    );
                  }),
                ];
              })}
              <TableRow className="border-t-2 font-semibold text-navy">
                <TableCell colSpan={5} className="text-right">
                  Totals
                </TableCell>
                <TableCell className="text-right tabular-nums">{exact(total)}</TableCell>
                <TableCell className="text-right tabular-nums">{exact(totalActual)}</TableCell>
                <TableCell>
                  <VarianceCell value={totalVariance} hasActual={totalActual > 0} />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function VarianceCell({ value, hasActual }: { value: number; hasActual: boolean }) {
  if (!hasActual) {
    return <span className="block text-right font-semibold tabular-nums text-ink-100">—</span>;
  }
  const isPositive = value >= 0;
  const abs = Math.abs(value);
  const formatted = exact(abs);
  return (
    <span
      className={cn(
        "block text-right font-semibold tabular-nums",
        isPositive ? "text-positive" : "text-red-600",
      )}
    >
      {isPositive ? `+${formatted}` : `-${formatted}`}
    </span>
  );
}
