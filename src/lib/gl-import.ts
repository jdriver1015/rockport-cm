import * as XLSX from "xlsx";

/**
 * Parses a raw GL export from a property-management system (BH/Yardi/etc.)
 * into normalized rows, then reconciles each to the internal chart of accounts
 * and to a work project. Tolerant of layout: detects columns by header text.
 */

export type ParsedGlRow = {
  sourceRow: number;
  vendorRaw: string | null;
  description: string | null;
  amount: number;
  txnDate: string | null; // YYYY-MM-DD
  invoiceNo: string | null;
  checkNo: string | null;
  drawNo: string | null;
  glAccountRaw: string | null;
  unitLabel: string | null;
};

export type GlParseResult = {
  rows: ParsedGlRow[];
  /** Rows skipped because no amount could be read */
  skipped: number;
};

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

function toDateStr(v: unknown): string | null {
  if (v == null || v === "") return null;
  // Excel serial date
  if (typeof v === "number") {
    const d = XLSX.SSF ? XLSX.SSF.parse_date_code(v) : null;
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString("en-CA");
  return null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

type ColMap = {
  headerRow: number;
  date?: number;
  vendor?: number;
  description?: number;
  amount?: number;
  debit?: number;
  invoice?: number;
  check?: number;
  draw?: number;
  account?: number;
  unit?: number;
};

function detectColumns(rows: unknown[][]): ColMap | null {
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const row = rows[r] ?? [];
    const map: ColMap = { headerRow: r };
    let hits = 0;
    const set = (key: keyof ColMap, c: number, counts = true) => {
      if (map[key] === undefined) {
        map[key] = c;
        if (counts) hits++;
      }
    };
    row.forEach((cell, c) => {
      if (typeof cell !== "string") return;
      const t = cell.trim().toLowerCase();
      if (/\bdate\b/.test(t)) set("date", c);
      if (/(vendor|payee|supplier|paid to)/.test(t)) set("vendor", c);
      if (/(description|memo|detail|narrative|work performed)/.test(t)) set("description", c);
      if (/(amount|amt|^total$|requested)/.test(t)) set("amount", c);
      if (/\bdebit\b/.test(t)) set("debit", c, false);
      if (/(invoice|inv\b|pay app|bill)/.test(t)) set("invoice", c);
      if (/(check|cheque|\bck\b)/.test(t)) set("check", c, false);
      if (/draw/.test(t)) set("draw", c, false);
      if (/(account|acct|gl code|gl acct|g\/l)/.test(t)) set("account", c);
      if (/(unit|property|location|common area)/.test(t)) set("unit", c);
    });
    // A plausible header row names at least a vendor/description and an amount
    const hasAmount = map.amount !== undefined || map.debit !== undefined;
    const hasLabel = map.vendor !== undefined || map.description !== undefined;
    if (hits >= 3 && hasAmount && hasLabel) return map;
  }
  return null;
}

export function parseGlWorkbook(buf: ArrayBuffer | Buffer): GlParseResult {
  const wb = XLSX.read(buf, { type: buf instanceof ArrayBuffer ? "array" : "buffer" });
  const out: ParsedGlRow[] = [];
  let skipped = 0;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    const cols = detectColumns(rows);
    if (!cols) continue;

    for (let r = cols.headerRow + 1; r < rows.length; r++) {
      const row = rows[r] ?? [];
      if (row.every((c) => c == null || c === "")) continue;

      const amount =
        (cols.amount !== undefined ? toNumber(row[cols.amount]) : null) ??
        (cols.debit !== undefined ? toNumber(row[cols.debit]) : null);
      if (amount === null || amount === 0) {
        skipped++;
        continue;
      }

      out.push({
        sourceRow: r + 1,
        vendorRaw: cols.vendor !== undefined ? str(row[cols.vendor]) : null,
        description: cols.description !== undefined ? str(row[cols.description]) : null,
        amount,
        txnDate: cols.date !== undefined ? toDateStr(row[cols.date]) : null,
        invoiceNo: cols.invoice !== undefined ? str(row[cols.invoice]) : null,
        checkNo: cols.check !== undefined ? str(row[cols.check]) : null,
        drawNo: cols.draw !== undefined ? str(row[cols.draw]) : null,
        glAccountRaw: cols.account !== undefined ? str(row[cols.account]) : null,
        unitLabel: cols.unit !== undefined ? str(row[cols.unit]) : null,
      });
    }
  }

  return { rows: out, skipped };
}

// ---------------------------------------------------------------------------
// Auto-mapping
// ---------------------------------------------------------------------------

export type MappingRule = {
  matchType: "gl_account" | "vendor" | "keyword";
  pattern: string;
  costCodeId: number;
  priority: number;
};

export type MapContext = {
  /** Rules sorted by priority ascending (lower wins) */
  rules: MappingRule[];
  /** Cost code id → isInterior */
  interiorByCode: Map<number, boolean>;
  /** Unit number (normalized) → unit id */
  unitIdByNumber: Map<string, number>;
  /** Unit id → unit project id */
  unitProjectByUnitId: Map<number, number>;
  /** Cost code id → common project ids on this property */
  commonProjectsByCode: Map<number, number[]>;
  /** Keys of existing posted txns: `${vendor}|${amount}|${invoice}` */
  postedKeys: Set<string>;
};

export type MappedGlRow = ParsedGlRow & {
  costCodeId: number | null;
  unitId: number | null;
  projectId: number | null;
  status: "staged" | "needs_review";
  isDuplicate: boolean;
};

/** Normalize a unit token like "614", "5111", "614A" */
function normUnit(s: string): string | null {
  const m = s.trim().match(/^#?(\d{2,5}[A-Za-z]?)$/);
  return m ? m[1].toUpperCase() : null;
}

export function extractUnitNumber(row: ParsedGlRow): string | null {
  if (row.unitLabel) {
    const direct = normUnit(row.unitLabel);
    if (direct) return direct;
  }
  const desc = row.description ?? "";
  const patterns = [/\bunit\s+#?(\d{2,5}[A-Za-z]?)\b/i, /\bfor\s+(?:unit\s+)?(\d{3,5}[A-Za-z]?)\b/i];
  for (const re of patterns) {
    const m = desc.match(re);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

function ruleMatches(row: ParsedGlRow, rule: MappingRule): boolean {
  const p = rule.pattern.toLowerCase();
  switch (rule.matchType) {
    case "gl_account":
      return (row.glAccountRaw ?? "").toLowerCase() === p;
    case "vendor":
      return (row.vendorRaw ?? "").toLowerCase().includes(p);
    case "keyword":
      return (row.description ?? "").toLowerCase().includes(p);
  }
}

export function dedupeKey(vendor: string | null, amount: number, invoice: string | null): string {
  return `${(vendor ?? "").toLowerCase().trim()}|${amount.toFixed(2)}|${(invoice ?? "").toLowerCase().trim()}`;
}

export function autoMapRow(row: ParsedGlRow, ctx: MapContext): MappedGlRow {
  let costCodeId: number | null = null;
  for (const rule of ctx.rules) {
    if (ruleMatches(row, rule)) {
      costCodeId = rule.costCodeId;
      break;
    }
  }

  // Attribute to a unit if we can read one
  const unitNo = extractUnitNumber(row);
  const unitId = unitNo ? (ctx.unitIdByNumber.get(unitNo) ?? null) : null;

  // Attribute to a project: unit project first, else a unique common project for the code
  let projectId: number | null = null;
  if (unitId !== null) {
    projectId = ctx.unitProjectByUnitId.get(unitId) ?? null;
  }
  if (projectId === null && costCodeId !== null) {
    const commons = ctx.commonProjectsByCode.get(costCodeId);
    if (commons && commons.length === 1) projectId = commons[0];
  }

  return {
    ...row,
    costCodeId,
    unitId,
    projectId,
    status: costCodeId !== null ? "staged" : "needs_review",
    isDuplicate: ctx.postedKeys.has(dedupeKey(row.vendorRaw, row.amount, row.invoiceNo)),
  };
}
