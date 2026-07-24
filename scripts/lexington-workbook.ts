/**
 * Shared constants + parsing helpers for the Lexington at Champions
 * construction-tracker import (scripts/seed-lexington-*.ts,
 * scripts/import-lexington-gl.ts). All read the same source workbook.
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

export const WORKBOOK_PATH =
  "C:/Users/JimmyDriver/OneDrive - crcapitaltx/CR Capital/3. Asset Management/The Lexington at Champions/5. Construction/Lexington at Champions - Construction Tracker.xlsx";

export const PROPERTY_ID = 2; // Lexington at Champions
export const CHART_ID = 1; // Westcreek Standard (shared chart)

export function loadWorkbook() {
  return XLSX.readFile(WORKBOOK_PATH);
}

export function sheetRows(wb: XLSX.WorkBook, name: string): unknown[][] {
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
}

/** Excel serial date (1900 system) → YYYY-MM-DD, or null if not a valid serial. */
export function excelSerialToISO(v: unknown): string | null {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Date.UTC(1899, 11, 30) + n * 86400000;
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Legacy Lexington cost code (Cost Code Bank sheet) → Westcreek Standard
 * (chart_id=1) cost code. Values are the `code` string; scripts resolve to
 * the current `id` at run time rather than hardcoding ids.
 */
export const LEGACY_CODE_MAP: Record<string, string> = {
  "15531": "1200-0001", // Windows/Glass/Doors - Renovation
  "15541": "1100-0001", // Roofing - Renovation
  "15571": "1600-0001", // Building & Common Area - Renovation
  "15581": "1400-0001", // Electrical - Renovation
  "15611": "1600-0003", // Equipment - Renovation
  "15612": "2000-0004", // HVAC - Renovation
  "15621": "4000-0002", // Interior Carpet - Renovation
  "15631": "4000-0002", // Interior Hard Surface Flooring - Renovation
  "15632": "1500-0003", // Parking Lot & Sidewalks - Renovation
  "15661": "1800-0002", // Pool - Renovation
  "15662": "1000-0001", // Exterior Paint and Carpentry - Renovation
  "15663": "1900-0001", // Landscaping - Renovation
  "15664": "1700-0001", // Signage - Renovation
  "15671": "4000-0001", // Interior Paint - Renovation
  "15673": "4000-0004", // Interior Countertops - Renovation
  "15674": "4000-0006", // Interior Cabinets - Renovation
  "15675": "4000-0005", // Interior Backsplash - Renovation
  "15676": "4000-0007", // Interior Fixtures - Renovation
  "15677": "4000-0008", // Interior Labor - Renovation
  "15678": "4000-0009", // Interior Miscellaneous - Renovation
  "15679": "4000-0003", // Interior Appliances - Renovations
  "15681": "3000-0003", // Construction Management Fee - Renovation
  "15692": "2000-0003", // Plumbing - Renovation
  "15510": "4000-0003", // Appliances - Operational
  "15650": "4000-0003", // Washer/Dryer - Operational
};

/** New cost code needed for the two budget lines with no existing catch-all. */
export const NEW_CODE = { categoryCode: "1300", code: "1300-0011", name: "General Exterior Repairs" };

/** Budget lines: target code -> UW Cost (non-zero rows only, Westcreek UW sheet). */
export const BUDGET_LINES: { code: string; uwAmount: number }[] = [
  { code: "1600-0001", uwAmount: 205000 }, // 15571 Building & Common Area
  { code: "1300-0011", uwAmount: 55000 }, // General Exterior Repairs (no legacy code)
  { code: "1600-0002", uwAmount: 150000 }, // Clubhouse Renovations (no legacy code)
  { code: "1100-0001", uwAmount: 25000 },
  { code: "1400-0001", uwAmount: 15000 },
  { code: "1700-0001", uwAmount: 50000 },
  { code: "1800-0002", uwAmount: 50000 },
  { code: "1900-0001", uwAmount: 75000 },
  { code: "4000-0001", uwAmount: 100000 },
  { code: "4000-0002", uwAmount: 150000 },
  { code: "4000-0003", uwAmount: 32000 },
  { code: "4000-0004", uwAmount: 101000 },
  { code: "4000-0006", uwAmount: 112000 },
  { code: "4000-0005", uwAmount: 21000 },
  { code: "4000-0007", uwAmount: 80000 },
  { code: "4000-0008", uwAmount: 35000 },
  { code: "4000-0009", uwAmount: 53000 },
  { code: "3000-0002", uwAmount: 100000 },
];

/** Floorplan -> bedrooms/sqft, from Unit Tracker Summary's "Units Type Upgrade Tracker". */
export const FLOORPLAN_SPECS: Record<string, { bedrooms: number; sqft: number }> = {
  A1: { bedrooms: 1, sqft: 788 },
  B1: { bedrooms: 2, sqft: 954 },
  B2: { bedrooms: 2, sqft: 1063 },
  B3: { bedrooms: 2, sqft: 1144 },
  B4: { bedrooms: 2, sqft: 1200 },
};

export type HomeRow = { unitNumber: string; floorplan: string };

/** Full unit roster from the "Home Details" sheet. */
export function parseHomeDetails(wb: XLSX.WorkBook): HomeRow[] {
  const rows = sheetRows(wb, "Home Details");
  const out: HomeRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] as unknown[];
    const unitNumber = String(r[2] ?? "").trim();
    const floorplan = String(r[3] ?? "").trim();
    if (unitNumber && floorplan) out.push({ unitNumber, floorplan });
  }
  return out;
}

export type TrackedUnit = {
  unitType: string;
  unitNumber: string;
  start: unknown;
  complete: unknown;
  status: string;
  budget: number;
  actual: number;
  previousRent: number | null;
  tradeOutRent: number | null;
  inPlaceRent: number | null;
  dateLeased: unknown;
  lines: { category: string; budget: number; actual: number }[];
};

/** The 10 already-tracked unit turns from the "Unit Tracker" sheet. */
export function parseUnitTracker(wb: XLSX.WorkBook): TrackedUnit[] {
  const rows = sheetRows(wb, "Unit Tracker");
  const units: TrackedUnit[] = [];
  let cur: TrackedUnit | null = null;
  for (let i = 6; i < rows.length; i++) {
    const r = rows[i] as unknown[];
    const c0 = String(r[0] ?? "").trim();
    const c1 = String(r[1] ?? "").trim();
    if (c0 === "Unit Type" || c1 === "Unit Number") continue; // repeated header
    if (c0 && c1) {
      if (cur) units.push(cur);
      cur = {
        unitType: c0,
        unitNumber: c1,
        start: r[2],
        complete: r[3],
        status: String(r[5] ?? "").trim(),
        budget: num(r[7]),
        actual: num(r[8]),
        previousRent: r[11] !== "" ? num(r[11]) : null,
        tradeOutRent: r[12] !== "" ? num(r[12]) : null,
        inPlaceRent: r[13] !== "" ? num(r[13]) : null,
        dateLeased: r[14],
        lines: [],
      };
    } else if (!c0 && c1 && cur) {
      cur.lines.push({ category: c1, budget: num(r[7]), actual: num(r[8]) });
    }
  }
  if (cur) units.push(cur);
  return units;
}

export type ScheduleGroup = {
  name: string;
  start: unknown;
  end: unknown;
  status: string;
  pctDone: number;
  costCode: string;
};

/** The 6 top-level groups from "Construction Schedule" (excludes the grand rollup row). */
export function parseConstructionSchedule(wb: XLSX.WorkBook): ScheduleGroup[] {
  const rows = sheetRows(wb, "Construction Schedule");
  const groupRowIndexes = [3, 12, 18, 20, 24, 27]; // Landscaping, Leasing Center, Lighting, Misc Exterior, Signage, Roof
  const codes = ["1900-0001", "1600-0001", "1400-0001", "1300-0011", "1700-0001", "1100-0001"];
  return groupRowIndexes.map((i, idx) => {
    const r = rows[i] as unknown[];
    return {
      name: String(r[0] ?? "").trim(),
      start: r[1],
      end: r[2],
      status: String(r[4] ?? "").trim(),
      pctDone: num(r[5]),
      costCode: codes[idx],
    };
  });
}

/** Read the raw workbook bytes for parseGlWorkbook. */
export function readWorkbookBuffer(): Buffer {
  return readFileSync(WORKBOOK_PATH);
}

/** Column indexes (0-based) on the "General Ledger" sheet, for a ColumnOverride. */
export const GL_COLUMNS = {
  sheetName: "General Ledger",
  headerRow: 0,
  draw: 0,
  // CR Category (col 1) is not mapped — description-only context, code carries the account.
  account: 2, // "Cost Code"
  vendor: 3,
  description: 4,
  unit: 5,
  amount: 6,
  invoice: 7,
  date: 8, // "Invoice Date" — populated on 160/162 rows vs 4/162 for "Date Paid"
};
