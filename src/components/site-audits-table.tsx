import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { ClickableTableRow } from "@/components/ui/clickable-table-row";
import {
  Table,
  TableBody,
  TableCell,
  TableGroupRow,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export type SiteAuditRow = {
  id: number;
  title: string;
  kind: string;
  auditDate: string;
  auditorName: string | null;
  status: string;
};

/** Section order mirrors the walk's place in a project's life: scope it,
 *  check on it, sign off on it. Ad-hoc "quality" walks read as the plain
 *  site inspections they are. */
const GROUPS: { key: string; label: string }[] = [
  { key: "pre_walk", label: "Pre-Walk" },
  { key: "quality", label: "Site Inspection" },
  { key: "punch_walk", label: "Punch Walk" },
];

const STATUS_LABEL: Record<string, string> = { draft: "Draft", complete: "Complete" };

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
        No audits yet. Click <span className="font-medium">New walk</span> to start a walk-through.
      </p>
    );
  }

  const groups = GROUPS.map((g) => ({
    ...g,
    audits: audits.filter((a) => a.kind === g.key),
  })).filter((g) => g.audits.length > 0);

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
          {groups.map((g) => (
            <Fragment key={g.key}>
              <TableGroupRow label={g.label} count={g.audits.length} colSpan={5} />
              {g.audits.map((a) => (
                <ClickableTableRow key={a.id} href={`/properties/${propertySlug}/audits/${a.id}`}>
                  <TableCell className="font-medium text-navy">{a.title}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(a.auditDate)}</TableCell>
                  <TableCell className="text-muted-foreground">{a.auditorName ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {findingsByAudit.get(a.id) ?? 0}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={a.status === "complete" ? "positive" : "pending"}
                      className={cn(
                        "text-[10.5px] font-bold tracking-[0.05em] uppercase",
                      )}
                    >
                      {STATUS_LABEL[a.status] ?? a.status}
                    </Badge>
                  </TableCell>
                </ClickableTableRow>
              ))}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
