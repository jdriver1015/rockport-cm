"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AmountCell } from "@/components/ui/amount-cell";
import { TableCard } from "@/components/ui/table-card";
import { BudgetLineDetailDialog } from "@/components/budget-line-detail-dialog";

export type AttachedProject = {
  id: number;
  name: string;
  stage: string;
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

export function BudgetView({
  propertyId,
  divisions,
}: {
  propertyId: number;
  divisions: BudgetDivision[];
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
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Budgeted</TableHead>
              <TableHead className="text-right">Planned</TableHead>
              <TableHead className="text-right">In Process</TableHead>
              <TableHead className="text-right">Completed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {divisions.flatMap((div) => [
              <TableRow key={`div-${div.key}`} className="bg-navy/5 hover:bg-navy/5">
                <TableCell className="text-sm font-bold uppercase tracking-wide text-navy">
                  {div.label}
                </TableCell>
                <TableCell>
                  <AmountCell value={div.budget} className="font-bold text-navy" />
                </TableCell>
                <TableCell>
                  <AmountCell value={div.planned} className="font-bold text-navy" />
                </TableCell>
                <TableCell>
                  <AmountCell value={div.inProcess} className="font-bold text-navy" />
                </TableCell>
                <TableCell>
                  <AmountCell value={div.completed} className="font-bold" positive />
                </TableCell>
              </TableRow>,
              ...div.categories.flatMap((cat) => [
                <TableRow key={`cat-${cat.code}`} className="bg-surface-sub hover:bg-surface-sub">
                  <TableCell className="pl-4 font-semibold text-text-body">{cat.name}</TableCell>
                  <TableCell>
                    <AmountCell value={cat.budget} className="text-text-body" />
                  </TableCell>
                  <TableCell>
                    <AmountCell value={cat.planned} />
                  </TableCell>
                  <TableCell>
                    <AmountCell value={cat.inProcess} />
                  </TableCell>
                  <TableCell>
                    <AmountCell value={cat.completed} positive />
                  </TableCell>
                </TableRow>,
                ...cat.lines.map((line) => (
                  <TableRow
                    key={line.code}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setSelected(line)}
                  >
                    <TableCell className="pl-8 text-muted-foreground">{line.name}</TableCell>
                    <TableCell>
                      <AmountCell value={line.budget} className="font-normal text-text-body" />
                    </TableCell>
                    <TableCell>
                      <AmountCell value={line.planned} className="font-normal text-text-body" />
                    </TableCell>
                    <TableCell>
                      <AmountCell value={line.inProcess} className="font-normal text-text-body" />
                    </TableCell>
                    <TableCell>
                      <AmountCell value={line.completed} positive />
                    </TableCell>
                  </TableRow>
                )),
              ]),
            ])}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-bold text-navy">Total</TableCell>
              <TableCell>
                <AmountCell value={totals.budget} />
              </TableCell>
              <TableCell>
                <AmountCell value={totals.planned} />
              </TableCell>
              <TableCell>
                <AmountCell value={totals.inProcess} />
              </TableCell>
              <TableCell>
                <AmountCell value={totals.completed} positive />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TableCard>
      <BudgetLineDetailDialog
        propertyId={propertyId}
        line={selected}
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
