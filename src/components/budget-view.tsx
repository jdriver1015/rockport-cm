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
import { cn } from "@/lib/utils";
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

type Mode = "summary" | "detail";

const MODES: { key: Mode; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "detail", label: "Detail" },
];

export function BudgetView({ categories }: { categories: BudgetCategory[] }) {
  const [mode, setMode] = useState<Mode>("summary");

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-md border border-border p-0.5">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            className={cn(
              "rounded px-3 py-1 text-sm font-medium transition-colors",
              mode === m.key ? "bg-navy text-white" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {categories.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No budget loaded yet.</p>
      ) : mode === "summary" ? (
        <SummaryTable categories={categories} />
      ) : (
        <DetailTable categories={categories} />
      )}
    </div>
  );
}

function SummaryTable({ categories }: { categories: BudgetCategory[] }) {
  const totals = sumTotals(categories);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="text-right">Budgeted</TableHead>
          <TableHead className="text-right">Committed</TableHead>
          <TableHead className="text-right">Completed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {categories.map((cat) => (
          <TableRow key={cat.code}>
            <TableCell className="font-mono text-xs font-semibold text-navy">{cat.code}</TableCell>
            <TableCell className="font-semibold text-navy">{cat.name}</TableCell>
            <TableCell className="text-right font-semibold tabular-nums text-navy">
              {money(cat.budget)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{money(cat.committed)}</TableCell>
            <TableCell className="text-right tabular-nums">{money(cat.completed)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell />
          <TableCell className="font-semibold text-navy">Total</TableCell>
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

function DetailTable({ categories }: { categories: BudgetCategory[] }) {
  const totals = sumTotals(categories);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="text-right">Budgeted</TableHead>
          <TableHead className="text-right">Committed</TableHead>
          <TableHead className="text-right">Completed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {categories.flatMap((cat) => [
          <TableRow key={`cat-${cat.code}`} className="bg-muted/60 hover:bg-muted/60">
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
          ...cat.lines.map((line) => (
            <TableRow key={line.code}>
              <TableCell className="pl-6 font-mono text-xs">{line.code}</TableCell>
              <TableCell>{line.name}</TableCell>
              <TableCell className="text-right tabular-nums">{money(line.budget)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(line.committed)}</TableCell>
              <TableCell className="text-right tabular-nums">{money(line.completed)}</TableCell>
            </TableRow>
          )),
        ])}
      </TableBody>
      <TableFooter>
        <TableRow>
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
