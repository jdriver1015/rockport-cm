"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TableSpacerRow,
} from "@/components/ui/table";
import { AmountCell } from "@/components/ui/amount-cell";
import { TableCard } from "@/components/ui/table-card";
import { BudgetLineDetailDialog } from "@/components/budget-line-detail-dialog";

export type AttachedProject = {
  id: number;
  name: string;
  phase: string;
  budget: number;
  committed: number;
  completed: number;
};

export type BudgetLineRow = {
  id: number;
  costCodeId: number;
  code: string;
  name: string;
  budget: number;
  planned: number;
  inProcess: number;
  completed: number;
  perUnitAmount: number | null;
  plannedUnits: number | null;
  isInterior: boolean;
  /**
   * True when this figure is computed from the interior plan rather than
   * hand-entered. Such rows have no budget_lines row behind them (their `id` is
   * synthetic and negative), so they are not editable here.
   */
  isDerived: boolean;
  note: string | null;
  projects: AttachedProject[];
};

export type BudgetCategory = {
  code: string;
  name: string;
  division: string | null;
  budget: number;
  planned: number;
  inProcess: number;
  completed: number;
  lines: BudgetLineRow[];
};

export type BudgetDivision = {
  key: string;
  label: string;
  budget: number;
  planned: number;
  inProcess: number;
  completed: number;
  categories: BudgetCategory[];
};

/** Description + the four money columns. */
const COLS = 5;

export function BudgetView({
  propertyId,
  propertySlug,
  divisions,
  locked,
}: {
  propertyId: number;
  propertySlug: string;
  divisions: BudgetDivision[];
  /** True while the budget is locked — line detail opens read-only. */
  locked?: boolean;
}) {
  const [selected, setSelected] = useState<BudgetLineRow | null>(null);

  const totals = sumTotals(divisions);

  if (divisions.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No budget loaded yet.</p>;
  }

  return (
    <>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Description</TableHead>
              <TableHead className="w-[15%] text-right">Budgeted</TableHead>
              <TableHead className="w-[15%] text-right">Planned</TableHead>
              <TableHead className="w-[15%] text-right">In Process</TableHead>
              <TableHead className="w-[15%] text-right">Completed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {divisions.flatMap((div, divIndex) => [
              // 14px of white air before each band but the first — this is what
              // keeps consecutive sections from reading as one striped mass.
              ...(divIndex > 0 ? [<TableSpacerRow key={`sp-${div.key}`} colSpan={COLS} />] : []),
              <TableRow key={`div-${div.key}`} className="border-0 bg-band hover:bg-band">
                <TableCell className="text-[11.5px] font-bold uppercase tracking-[0.09em] text-ink-900">
                  {div.label}
                </TableCell>
                <TableCell>
                  <AmountCell value={div.budget} className="font-bold text-ink-900" emptyClassName="text-ink-200" />
                </TableCell>
                <TableCell>
                  <AmountCell value={div.planned} className="font-bold text-ink-900" emptyClassName="text-ink-200" />
                </TableCell>
                <TableCell>
                  <AmountCell value={div.inProcess} className="font-bold text-ink-900" emptyClassName="text-ink-200" />
                </TableCell>
                <TableCell>
                  <AmountCell value={div.completed} className="font-bold" positive emptyClassName="text-ink-200" />
                </TableCell>
              </TableRow>,
              ...div.categories.flatMap((cat) => [
                <TableRow key={`cat-${cat.code}`}>
                  <TableCell className="font-semibold text-ink-700">{cat.name}</TableCell>
                  <TableCell>
                    <AmountCell value={cat.budget} className="font-semibold text-ink-700" emptyClassName="text-ink-200" />
                  </TableCell>
                  <TableCell>
                    <AmountCell value={cat.planned} className="font-semibold text-ink-700" emptyClassName="text-ink-200" />
                  </TableCell>
                  <TableCell>
                    <AmountCell value={cat.inProcess} className="font-semibold text-ink-700" emptyClassName="text-ink-200" />
                  </TableCell>
                  <TableCell>
                    <AmountCell value={cat.completed} className="font-semibold" positive emptyClassName="text-ink-200" />
                  </TableCell>
                </TableRow>,
                ...cat.lines.map((line) => (
                  <TableRow
                    key={line.code}
                    className={line.isDerived ? undefined : "cursor-pointer"}
                    onClick={() => {
                      // Derived rows are computed from the interior plan; there's
                      // no line to edit, so opening the editor would be a lie.
                      if (!line.isDerived) setSelected(line);
                    }}
                  >
                    <TableCell className="pl-12 text-ink-500">
                      {line.name}
                      {line.isDerived && (
                        <Lock
                          className="ml-1.5 inline size-3 -translate-y-px text-ink-300"
                          aria-label="Computed from the interior plan"
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <AmountCell value={line.budget} className="font-normal text-ink-500" />
                    </TableCell>
                    <TableCell>
                      <AmountCell value={line.planned} className="font-normal text-ink-500" />
                    </TableCell>
                    <TableCell>
                      <AmountCell value={line.inProcess} className="font-normal text-ink-500" />
                    </TableCell>
                    <TableCell>
                      <AmountCell value={line.completed} className="font-normal" positive />
                    </TableCell>
                  </TableRow>
                )),
              ]),
            ])}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-band">
              <TableCell className="font-bold text-ink-900">Total</TableCell>
              <TableCell>
                <AmountCell value={totals.budget} className="font-bold text-ink-900" emptyClassName="text-ink-200" />
              </TableCell>
              <TableCell>
                <AmountCell value={totals.planned} className="font-bold text-ink-900" emptyClassName="text-ink-200" />
              </TableCell>
              <TableCell>
                <AmountCell value={totals.inProcess} className="font-bold text-ink-900" emptyClassName="text-ink-200" />
              </TableCell>
              <TableCell>
                <AmountCell value={totals.completed} className="font-bold" positive emptyClassName="text-ink-200" />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TableCard>
      <BudgetLineDetailDialog
        propertyId={propertyId}
        propertySlug={propertySlug}
        line={selected}
        locked={locked ?? false}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function sumTotals(divisions: BudgetDivision[]) {
  return divisions.reduce(
    (acc, div) => ({
      budget: acc.budget + div.budget,
      planned: acc.planned + div.planned,
      inProcess: acc.inProcess + div.inProcess,
      completed: acc.completed + div.completed,
    }),
    { budget: 0, planned: 0, inProcess: 0, completed: 0 },
  );
}
