import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/format";

export type SiteAuditRow = {
  id: number;
  title: string;
  auditDate: string;
  auditorName: string | null;
  status: string;
};

export function SiteAuditsTable({
  propertySlug,
  audits,
  findingsByAudit,
}: {
  propertySlug: string;
  audits: SiteAuditRow[];
  findingsByAudit: Map<number, number>;
}) {
  if (audits.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No audits yet. Click <span className="font-medium">New audit</span> to start a walk-through.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Auditor</TableHead>
            <TableHead className="text-right">Findings</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {audits.map((a) => (
            <TableRow key={a.id} className="cursor-pointer">
              <TableCell className="font-medium text-navy">
                <Link href={`/properties/${propertySlug}/audits/${a.id}`} className="hover:underline">
                  {a.title}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{fmtDate(a.auditDate)}</TableCell>
              <TableCell className="text-muted-foreground">{a.auditorName ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{findingsByAudit.get(a.id) ?? 0}</TableCell>
              <TableCell>
                <Badge variant={a.status === "complete" ? "positive" : "pending"}>{a.status}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
