"use client";

import { useState } from "react";
import { PlusIcon, MinusIcon } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money } from "@/lib/format";

export type BudgetLineRow = {
  code: string;
  name: string;
  budget: number;
  committed: number;
  completed: number;
};

export type BudgetCategory = {
  code: string;
  name: string;
  budget: number;
  committed: number;
  completed: number;
  lines: BudgetLineRow[];
};

export function BudgetView({ categories }: { categories: BudgetCategory[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(code: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  const totals = sumTotals(categories);

  if (categories.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No budget loaded yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead>Code</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="text-right">Budgeted</TableHead>
          <TableHead className="text-right">Committed</TableHead>
          <TableHead className="text-right">Completed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {categories.flatMap((cat) => {
          const isOpen = expanded.has(cat.code);
          const rows = [
            <TableRow
              key={`cat-${cat.code}`}
              className="cursor-pointer bg-muted/60 hover:bg-muted"
              onClick={() => toggle(cat.code)}
            >
              <TableCell>
                <span className="flex size-5 items-center justify-center rounded border border-border bg-card text-muted-foreground">
                  {isOpen ? <MinusIcon className="size-3" /> : <PlusIcon className="size-3" />}
                </span>
              </TableCell>
              <TableCell className="font-mono text-xs font-bold text-navy">{cat.code}</TableCell>
              <TableCell className="font-bold text-navy">{cat.name}</TableCell>
              <TableCell className="text-right font-bold tabular-nums text-navy">
                {money(cat.budget)}
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums text-navy">
                {money(cat.committed)}
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums text-navy">
                {money(cat.completed)}
              </TableCell>
            </TableRow>,
          ];
          if (isOpen) {
            rows.push(
              ...cat.lines.map((line) => (
                <TableRow key={line.code}>
                  <TableCell />
                  <TableCell className="pl-6 font-mono text-xs">{line.code}</TableCell>
                  <TableCell>{line.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(line.budget)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(line.committed)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(line.completed)}</TableCell>
                </TableRow>
              )),
            );
          }
          return rows;
        })}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell />
          <TableCell className="font-semibold text-navy">Total</TableCell>
          <TableCell />
          <TableCell className="text-right font-semibold tabular-nums text-navy">
            {money(totals.budget)}
          </TableCell>
          <TableCell className="text-right font-semibold tabular-nums text-navy">
            {money(totals.committed)}
          </TableCell>
          <TableCell className="text-right font-semibold tabular-nums text-navy">
            {money(totals.completed)}
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

function sumTotals(categories: BudgetCategory[]) {
  return categories.reduce(
    (acc, cat) => ({
      budget: acc.budget + cat.budget,
      committed: acc.committed + cat.committed,
      completed: acc.completed + cat.completed,
    }),
    { budget: 0, committed: 0, completed: 0 },
  );
}
