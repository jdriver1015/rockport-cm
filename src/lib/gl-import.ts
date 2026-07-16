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

/** One GL-account section from a grouped ledger export (account = header row). */
export type GlAccountSection = {
  /** Account code exactly as printed, e.g. "1740-0006" or "1771-18" */
  code: string;
  /** Account name from the section header, e.g. "Architectural" (may be null) */
  name: string | null;
  rows: ParsedGlRow[];
  /** Net of the section's rows (debits positive) */
  total: number;
};

export type GlParseResult = {
  /** Flattened rows across all sections, each tagged with its glAccountRaw */
  rows: ParsedGlRow[];
  /** Rows grouped by their GL-account section (empty for flat layouts) */
  sections: GlAccountSection[];
  /** "grouped" = account carried from section headers; "flat" = account per row (or none) */
  layout: "grouped" | "flat";
  /** Reporting period / as-of date read from the banner, if any (YYYY-MM-DD) */
  periodDate: string | null;
  /** Normalized header labels, for format fingerprinting */
  headerLabels: string[];
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
  /** Lowercased/trimmed header labels for every column, for fingerprinting */
  labels: string[];
  date?: number;
  vendor?: number;
  description?: number;
  amount?: number;
  debit?: number;
  credit?: number;
  invoice?: number;
  check?: number;
  draw?: number;
  account?: number;
  unit?: number;
};

function detectColumns(rows: unknown[][]): ColMap | null {
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const row = rows[r] ?? [];
    const labels = row.map((c) => (typeof c === "string" ? c.trim().toLowerCase() : ""));
    const map: ColMap = { headerRow: r, labels };
    let hits = 0;
    const set = (key: keyof ColMap, c: number, counts = true) => {
      if (map[key] === undefined) {
        (map as Record<string, unknown>)[key] = c;
        if (counts) hits++;
      }
    };
    labels.forEach((t, c) => {
      if (t === "") return;
      if (/\bdate\b/.test(t)) set("date", c);
      // Payee/vendor: PM systems label this variously. "person/description" (Yardi),
      // "name" (ResMan), "tenant/vendor" (Yardi) all carry the payee.
      if (/(vendor|payee|supplier|paid to|tenant\/vendor|person\/description|^name$)/.test(t))
        set("vendor", c);
      if (/(description|memo|detail|narrative|work performed|remarks)/.test(t)) set("description", c);
      if (/(amount|amt|^total$|requested)/.test(t)) set("amount", c);
      if (/\bdebit\b/.test(t)) set("debit", c, false);
      if (/\bcredit\b/.test(t)) set("credit", c, false);
      // Reference/control numbers double as the invoice/reference on these exports.
      if (/(invoice|inv\b|pay app|bill|reference|control)/.test(t)) set("invoice", c);
      if (/(check|cheque|\bck\b)/.test(t)) set("check", c, false);
      if (/draw/.test(t)) set("draw", c, false);
      if (/(account|acct|gl code|gl acct|g\/l)/.test(t)) set("account", c);
      // Only a real per-row unit column — NOT a "Property" column (ResMan's
      // "Property" holds the property code, not a unit).
      if (/\bunit\b|location|common area/.test(t)) set("unit", c);
    });
    // A plausible header row names at least a vendor/description and an amount/debit
    const hasAmount = map.amount !== undefined || map.debit !== undefined;
    const hasLabel = map.vendor !== undefined || map.description !== undefined;
    if (hits >= 3 && hasAmount && hasLabel) return map;
  }
  return null;
}

/** An account-section header row like "1740-0006 Architectural" or "1000-05 ... = Beginning Balance =". */
const ACCT_CODE_RE = /^\s*(\d{3,5}[-.]\d{2,5})\b\s*(.*)$/;

function cleanAccountName(s: string): string | null {
  return s.replace(/[:=]+/g, " ").replace(/\s+/g, " ").trim() || null;
}

function detectAccountSection(row: unknown[]): { code: string; name: string | null } | null {
  // The account code appears in one of the first cells; data rows never carry a
  // dashed account code there (they hold a property code, date, or amount).
  for (let c = 0; c < Math.min(row.length, 3); c++) {
    const v = row[c];
    if (typeof v !== "string") continue;
    const m = v.match(ACCT_CODE_RE);
    if (!m) continue;
    // Name may sit right after the code (ResMan: "1740-0006 Architectural") or in
    // a later column (Yardi puts it in the Person/Description column).
    let name = cleanAccountName(m[2] || "");
    if (!name) {
      for (let k = c + 1; k < row.length; k++) {
        const cell = row[k];
        if (typeof cell !== "string") continue;
        const t = cell.trim();
        if (t === "" || /balance|^=|=$/i.test(t) || ACCT_CODE_RE.test(t)) continue;
        name = cleanAccountName(t);
        break;
      }
    }
    return { code: m[1], name };
  }
  return null;
}

/** Noise rows that carry no importable transaction. */
function isNoiseRow(row: unknown[], cols: ColMap): boolean {
  const joined = row
    .map((c) => (c == null ? "" : String(c)))
    .join(" ")
    .toLowerCase();
  if (/beginning balance|ending balance|net change/.test(joined)) return true;
  // ResMan daily rollups: "Summary - 5/1/2026" + "232 Entries"
  if (/\bsummary\b/.test(joined) && /\bentries\b/.test(joined)) return true;
  // Totals/subtotals for a section
  const desc = cols.description !== undefined ? str(row[cols.description]) : null;
  const vendor = cols.vendor !== undefined ? str(row[cols.vendor]) : null;
  const label = (desc ?? vendor ?? "").toLowerCase();
  if (/^(sub)?total\b/.test(label)) return true;
  return false;
}

/** Read the reporting period / as-of date from the banner rows above the header. */
function detectPeriodDate(rows: unknown[][], headerRow: number): string | null {
  const monthRe =
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}/i;
  for (let r = 0; r < headerRow; r++) {
    for (const cell of rows[r] ?? []) {
      if (typeof cell !== "string") continue;
      const m = cell.match(monthRe);
      if (m) {
        const d = new Date(m[0].replace(/period\s*=\s*/i, "").trim());
        if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("en-CA");
      }
    }
  }
  return null;
}

export function parseGlWorkbook(buf: ArrayBuffer | Buffer): GlParseResult {
  const wb = XLSX.read(buf, { type: buf instanceof ArrayBuffer ? "array" : "buffer" });
  const out: ParsedGlRow[] = [];
  const sectionsByCode = new Map<string, GlAccountSection>();
  let skipped = 0;
  let layout: "grouped" | "flat" = "flat";
  let periodDate: string | null = null;
  let headerLabels: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    const cols = detectColumns(rows);
    if (!cols) continue;

    if (headerLabels.length === 0) headerLabels = cols.labels.filter((l) => l !== "");
    if (periodDate === null) periodDate = detectPeriodDate(rows, cols.headerRow);

    // The GL account may be a per-row column (flat) or a section header the rows
    // hang under (grouped, as Yardi/ResMan export). Track the running section.
    let current: { code: string; name: string | null } | null = null;

    for (let r = cols.headerRow + 1; r < rows.length; r++) {
      const row = rows[r] ?? [];
      if (row.every((c) => c == null || c === "")) continue;

      // Section header? Update the running account and move on.
      const section = detectAccountSection(row);
      if (section) {
        current = section;
        layout = "grouped";
        if (!sectionsByCode.has(section.code)) {
          sectionsByCode.set(section.code, {
            code: section.code,
            name: section.name,
            rows: [],
            total: 0,
          });
        } else if (section.name && !sectionsByCode.get(section.code)!.name) {
          sectionsByCode.get(section.code)!.name = section.name;
        }
        continue;
      }

      if (isNoiseRow(row, cols)) continue;

      // Net debit/credit into a signed amount (debits positive = spend), or fall
      // back to a single amount column.
      let amount: number | null = null;
      if (cols.debit !== undefined || cols.credit !== undefined) {
        const debit = cols.debit !== undefined ? (toNumber(row[cols.debit]) ?? 0) : 0;
        const credit = cols.credit !== undefined ? (toNumber(row[cols.credit]) ?? 0) : 0;
        amount = debit - credit;
      } else if (cols.amount !== undefined) {
        amount = toNumber(row[cols.amount]);
      }
      if (amount === null || amount === 0) {
        skipped++;
        continue;
      }

      const glAccountRaw =
        current?.code ?? (cols.account !== undefined ? str(row[cols.account]) : null);

      const parsedRow: ParsedGlRow = {
        sourceRow: r + 1,
        vendorRaw: cols.vendor !== undefined ? str(row[cols.vendor]) : null,
        description: cols.description !== undefined ? str(row[cols.description]) : null,
        amount,
        txnDate: cols.date !== undefined ? toDateStr(row[cols.date]) : null,
        invoiceNo: cols.invoice !== undefined ? str(row[cols.invoice]) : null,
        checkNo: cols.check !== undefined ? str(row[cols.check]) : null,
        drawNo: cols.draw !== undefined ? str(row[cols.draw]) : null,
        glAccountRaw,
        unitLabel: cols.unit !== undefined ? str(row[cols.unit]) : null,
      };
      out.push(parsedRow);

      if (current) {
        const sec = sectionsByCode.get(current.code)!;
        sec.rows.push(parsedRow);
        sec.total += amount;
      }
    }
  }

  const sections = [...sectionsByCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  return { rows: out, sections, layout, periodDate, headerLabels, skipped };
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

// ---------------------------------------------------------------------------
// Format fingerprinting + construction-account detection
// ---------------------------------------------------------------------------

/** Stable hash of a header row's labels, order-independent — a format signature. */
export function fingerprintHeaders(labels: string[]): string {
  const norm = labels
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("|");
  // FNV-1a 32-bit — no runtime crypto dependency, deterministic across envs.
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const CONSTRUCTION_KW =
  /(renov|rehab|hvac|roof|floor|carpet|paint|concrete|electric|plumb|contractor|\bgc\b|capital improvement|construction|appliance|cabinet|countertop|drywall|turnover|fence|gutter|architect|masonry|window|door|sidewalk|parking lot|pool|boiler|elevator|landscap|fixture|signage|clubhouse|model unit|water ?proof|carpentry|stair|rail|siding|deck|patio|balcony)/i;

/**
 * Best-guess of whether a GL account section is construction/CapEx, used to
 * pre-check the account-selection checklist. Capital/fixed-asset series (1700s)
 * are the strong signal; a construction keyword in the name promotes other
 * 1000-series (balance-sheet) accounts. Operating/income accounts (4000+) are
 * never auto-suggested — the user can still add them by hand.
 */
export function suggestConstructionAccount(code: string, name: string | null): boolean {
  const lead = Number((code.match(/^(\d{3,5})/) ?? [])[1]);
  if (Number.isNaN(lead)) return false;
  if (lead >= 1700 && lead <= 1799) return true;
  if (lead >= 1000 && lead <= 1999 && name != null && CONSTRUCTION_KW.test(name)) return true;
  return false;
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
