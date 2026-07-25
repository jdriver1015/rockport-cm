import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { moneyExact, fmtDate } from "@/lib/format";

export type CostRow = {
  id: number;
  txnDate: string | null;
  vendor: string;
  description: string | null;
  invoiceNo: string | null;
  costCodeName: string | null;
  amount: string;
};

export function ProjectCostTable({
  rows,
  total,
}: {
  rows: CostRow[];
  total: number;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base text-navy">Cost detail</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No posted GL transactions for this project.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-navy">Cost detail</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Date</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Invoice #</TableHead>
              <TableHead>Cost code</TableHead>
              <TableHead className="text-right w-28">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-muted-foreground">{fmtDate(r.txnDate)}</TableCell>
                <TableCell>{r.vendor}</TableCell>
                <TableCell className="text-muted-foreground">{r.description ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{r.invoiceNo ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{r.costCodeName ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{moneyExact(r.amount)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold border-t-2">
              <TableCell colSpan={5} className="text-right">Total</TableCell>
              <TableCell className="text-right tabular-nums">{moneyExact(total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
