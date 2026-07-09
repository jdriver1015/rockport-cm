import * as XLSX from "xlsx";

/**
 * Parses a dropped budget workbook into rows matched against the chart of
 * accounts. Tolerant of layout: prefers a header row ("Cost Code" + an
 * amount column), falls back to scanning any row containing a ####-####
 * code, and finally matches rows by cost-code *name* when no code is present.
 */

export type CoaCode = { id: number; code: string; name: string; isInterior: boolean };

export type MatchedRow = {
  costCodeId: number;
  code: string;
  name: string;
  uwAmount: number;
  perUnitAmount?: number;
  plannedUnits?: number;
  /** true when several source rows summed into this one */
  merged?: boolean;
};

export type UnmatchedRow = {
  sheet: string;
  row: number;
  text: string;
  amount: number | null;
};

export type BudgetParseResult = {
  rows: MatchedRow[];
  unmatched: UnmatchedRow[];
  total: number;
};

const CODE_RE = /^\s*(\d{4})\s*-\s*(\d{4})\s*$/;

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const neg = /^\(.*\)$/.test(v.trim());
    const cleaned = v.replace(/[$,()\s]/g, "");
    if (cleaned === "" || Number.isNaN(Number(cleaned))) return null;
    return neg ? -Number(cleaned) : Number(cleaned);
  }
  return null;
}

function normCode(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const m = String(v).match(CODE_RE);
  return m ? `${m[1]}-${m[2]}` : null;
}

function normName(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

type HeaderMap = {
  headerRow: number;
  codeCol: number;
  amountCol: number;
  perUnitCol?: number;
  unitsCol?: number;
};

function findHeader(rows: unknown[][]): HeaderMap | null {
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const row = rows[r] ?? [];
    let codeCol = -1;
    let amountCol = -1;
    let perUnitCol: number | undefined;
    let unitsCol: number | undefined;
    row.forEach((cell, c) => {
      if (typeof cell !== "string") return;
      const t = cell.trim().toLowerCase();
      if (codeCol < 0 && /cost\s*code/.test(t)) codeCol = c;
      if (perUnitCol === undefined && /per\s*unit/.test(t)) perUnitCol = c;
      if (unitsCol === undefined && /(planned\s*units|unit\s*count|#\s*of\s*units|qty)/.test(t))
        unitsCol = c;
    });
    if (codeCol < 0) continue;
    // Prefer an explicitly-labeled UW/budget column; fall back to amount/cost/total
    row.forEach((cell, c) => {
      if (typeof cell !== "string" || c === codeCol || c === perUnitCol || c === unitsCol) return;
      const t = cell.trim().toLowerCase();
      if (/(uw|underwrit|budget)/.test(t)) amountCol = c;
    });
    if (amountCol < 0) {
      row.forEach((cell, c) => {
        if (typeof cell !== "string" || c === codeCol || c === perUnitCol || c === unitsCol) return;
        const t = cell.trim().toLowerCase();
        if (amountCol < 0 && /(amount|cost|total)/.test(t)) amountCol = c;
      });
    }
    if (amountCol >= 0) return { headerRow: r, codeCol, amountCol, perUnitCol, unitsCol };
  }
  return null;
}

export function parseBudgetWorkbook(buf: ArrayBuffer | Buffer, coa: CoaCode[]): BudgetParseResult {
  const wb = XLSX.read(buf, { type: buf instanceof ArrayBuffer ? "array" : "buffer" });
  const byCode = new Map(coa.map((c) => [c.code, c]));
  const byName = new Map(coa.map((c) => [normName(c.name), c]));

  const found = new Map<number, MatchedRow>();
  const unmatched: UnmatchedRow[] = [];

  const addAmount = (
    coaRow: CoaCode,
    amount: number,
    perUnit: number | null,
    units: number | null,
  ) => {
    const existing = found.get(coaRow.id);
    if (existing) {
      existing.uwAmount += amount;
      existing.merged = true;
    } else {
      found.set(coaRow.id, {
        costCodeId: coaRow.id,
        code: coaRow.code,
        name: coaRow.name,
        uwAmount: amount,
        perUnitAmount: perUnit ?? undefined,
        plannedUnits: units ?? undefined,
      });
    }
  };

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    const header = findHeader(rows);

    const startRow = header ? header.headerRow + 1 : 0;
    for (let r = startRow; r < rows.length; r++) {
      const row = rows[r] ?? [];
      if (row.every((c) => c == null || c === "")) continue;

      let code: string | null = null;
      let amount: number | null = null;
      let perUnit: number | null = null;
      let units: number | null = null;
      let nameCell = "";

      if (header) {
        code = normCode(row[header.codeCol]);
        amount = toNumber(row[header.amountCol]);
        perUnit = header.perUnitCol !== undefined ? toNumber(row[header.perUnitCol]) : null;
        units = header.unitsCol !== undefined ? toNumber(row[header.unitsCol]) : null;
        nameCell = row
          .filter((c, i) => typeof c === "string" && i !== header.codeCol)
          .map(String)
          .join(" ")
          .trim();
      } else {
        // Free-form scan: first ####-#### cell is the code, first numeric
        // cell after it is the amount, nearest string cell is the name.
        const codeIdx = row.findIndex((c) => normCode(c) !== null);
        if (codeIdx >= 0) {
          code = normCode(row[codeIdx]);
          for (let c = codeIdx + 1; c < row.length; c++) {
            const n = toNumber(row[c]);
            if (n !== null) {
              amount = n;
              break;
            }
          }
          nameCell = row
            .filter((c, i) => typeof c === "string" && i !== codeIdx)
            .map(String)
            .join(" ")
            .trim();
        }
      }

      if (code && byCode.has(code)) {
        if (amount === null) continue; // code row without an amount — ignore silently
        addAmount(byCode.get(code)!, amount, perUnit, units);
        continue;
      }

      // Name-based fallback: a text cell that exactly matches a cost-code name
      // followed by a numeric amount somewhere in the row.
      const nameIdx = row.findIndex((c) => typeof c === "string" && byName.has(normName(c)));
      if (nameIdx >= 0) {
        let rowAmount: number | null = null;
        for (let c = nameIdx + 1; c < row.length; c++) {
          const n = toNumber(row[c]);
          if (n !== null) {
            rowAmount = n;
            break;
          }
        }
        if (rowAmount !== null) {
          addAmount(byName.get(normName(row[nameIdx]))!, rowAmount, null, null);
          continue;
        }
      }

      // A row that *looks* like data (has a code-ish or text + number) but didn't match
      const hasNumber = row.some((c) => toNumber(c) !== null && toNumber(c) !== 0);
      const hasText = row.some((c) => typeof c === "string" && String(c).trim().length > 2);
      if (code || (hasNumber && hasText && header)) {
        unmatched.push({
          sheet: sheetName,
          row: r + 1,
          text: (code ?? nameCell).slice(0, 80),
          amount,
        });
      }
    }
  }

  const rows = [...found.values()].sort((a, b) => a.code.localeCompare(b.code));
  return {
    rows,
    unmatched: unmatched.slice(0, 50),
    total: rows.reduce((s, r) => s + r.uwAmount, 0),
  };
}
