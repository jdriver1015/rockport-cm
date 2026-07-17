import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PRICING_METHOD_LABELS, type PricingMethod } from "@/lib/pricing";

export type PricedScopeRow = {
  id: number;
  item: string;
  materialQuality: string | null;
  pricingMethod: PricingMethod | null;
  unitPrice: string | null;
  quantity: string | null;
  costCode: string | null;
};

const money = (v: number) =>
  `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Read-only scope view for interior projects generated from a scope group.
 * Shows each line's pricing method, quantity, unit price, and derived total
 * (quantity × unitPrice) with a grand total — the sum that seeded the budget.
 */
export function PricedScopeTable({ items }: { items: PricedScopeRow[] }) {
  const lineTotal = (r: PricedScopeRow) =>
    r.quantity != null && r.unitPrice != null ? Number(r.quantity) * Number(r.unitPrice) : 0;
  const total = items.reduce((s, r) => s + lineTotal(r), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-navy">Scope &amp; estimate</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Code</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium text-navy">{r.item}</div>
                    {r.materialQuality && (
                      <div className="text-xs text-muted-foreground">{r.materialQuality}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.pricingMethod ? PRICING_METHOD_LABELS[r.pricingMethod] : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {r.costCode ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.quantity != null ? Number(r.quantity).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.unitPrice != null ? money(Number(r.unitPrice)) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(lineTotal(r))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="mt-3 flex items-center justify-between border-t pt-3 text-sm font-semibold text-navy">
          <span>Estimated total</span>
          <span className="tabular-nums">{money(total)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
