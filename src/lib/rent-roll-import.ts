/**
 * Rent-roll parse orchestrator — turns an uploaded file (Excel/CSV/PDF) into a
 * structured ParseResult. Pure of the DB: it takes format-memory + past
 * examples as inputs and returns units + rollups + warnings. DB glue (loading
 * memory, inserting rows, saving formats) lives in rent-roll-pipeline.ts.
 *
 * Excel/CSV path runs three tiers, cheapest first:
 *   1. deterministic format replay (a previously confirmed header layout)
 *   2. AI column mapper (Claude)
 *   3. keyword heuristic fallback
 * PDF path uses Claude's native document extraction.
 *
 * Ported from the DealCompass importer (parseRentRollCore).
 */
import * as XLSX from "xlsx";
import {
  applyMapping,
  detectSummaryFromTail,
  findFormatReplay,
  foldedHeaderLabels,
  headerFingerprint,
  heuristicMapping,
  replayAcceptable,
  toDate,
  type AiMapping,
  type ParsedUnit,
  type RowFlag,
} from "@/lib/rent-roll-mapping";
import { callAiMapper, extractPdfRentRoll, rankRentRollSheets } from "@/lib/ai/rent-roll-ai";

export type FloorplanRollup = {
  code: string;
  count: number;
  occupied_count: number;
  occupancy_pct: number;
  avg_sqft: number;
  avg_market_rent: number;
  avg_in_place_rent: number;
};

export type ParseStats = {
  unit_count: number;
  parsed_unit_rows: number;
  occupied: number;
  vacant: number;
  notice: number;
  occupancy: number;
  total_market_rent: number;
  total_in_place_rent: number;
  loss_to_lease: number;
  from_property_summary: boolean;
  as_of_date: string | null;
};

export type RawSheet = {
  sheet_name: string;
  total_rows: number;
  rows: (string | number | null)[][];
  truncated: boolean;
};

export type ParseMethod = "format_replay" | "ai" | "heuristic" | "pdf_ai";

export type RentRollParseResult = {
  units: ParsedUnit[];
  floorplans: FloorplanRollup[];
  stats: ParseStats;
  warnings: string[];
  rowFlags: RowFlag[];
  mapping: AiMapping | null;
  parseMethod: ParseMethod;
  asOfDate: string | null;
  rawSheet: RawSheet;
  /** Header fingerprint + labels for format/example memory (null for PDF). */
  fingerprint: string | null;
  headerLabels: string[];
};

export type ParseInput = {
  formatMemory?: Map<string, string>; // fingerprint → mapping JSON
  pastExamples?: Array<{ raw_label: string; mapped_to: string }>;
  instructions?: string;
};

const RAW_ROW_CAP = 2000;
const RAW_CELL_CAP = 200;

function isPdf(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf.slice(0, 5));
  // %PDF-
  return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
}

function buildFloorplans(units: ParsedUnit[]): FloorplanRollup[] {
  const map = new Map<
    string,
    { code: string; count: number; occupied: number; sum_sqft: number; sum_market: number; sum_in_place: number }
  >();
  for (const u of units) {
    const code = u.floor_plan_code ?? "—";
    const cur =
      map.get(code) ?? { code, count: 0, occupied: 0, sum_sqft: 0, sum_market: 0, sum_in_place: 0 };
    cur.count += 1;
    if (u.status !== "vacant") {
      cur.occupied += 1;
      cur.sum_in_place += u.in_place_rent ?? 0;
    }
    cur.sum_sqft += u.square_feet ?? 0;
    cur.sum_market += u.market_rent ?? 0;
    map.set(code, cur);
  }
  return Array.from(map.values()).map((f) => ({
    code: f.code,
    count: f.count,
    occupied_count: f.occupied,
    occupancy_pct: f.count ? f.occupied / f.count : 0,
    avg_sqft: f.count ? Math.round(f.sum_sqft / f.count) : 0,
    avg_market_rent: f.count ? Math.round(f.sum_market / f.count) : 0,
    avg_in_place_rent: f.occupied ? Math.round(f.sum_in_place / f.occupied) : 0,
  }));
}

/** Physical occupancy convention: anything NOT vacant counts as occupied
 *  (notice-to-vacate residents are still living there; future/leased count too). */
function buildStats(
  units: ParsedUnit[],
  summary: {
    total_units?: number | null;
    occupied_units?: number | null;
    vacant_units?: number | null;
    notice_units?: number | null;
    occupancy_pct?: number | null;
  } | null,
  asOfDate: string | null,
): ParseStats {
  const vacantFromUnits = units.filter((u) => u.status === "vacant").length;
  const noticeFromUnits = units.filter((u) => u.status === "notice").length;
  const totalMarket = units.reduce((s, u) => s + (u.market_rent ?? 0), 0);
  const totalInPlace = units.reduce((s, u) => s + (u.in_place_rent ?? 0), 0);

  const total = summary?.total_units ?? units.length;
  const vacant = summary?.vacant_units ?? vacantFromUnits;
  const occupied = summary?.occupied_units ?? total - vacant;
  const notice = summary?.notice_units ?? noticeFromUnits;
  const occupancy = summary?.occupancy_pct ?? (total ? occupied / total : 0);
  const lossToLease = totalMarket > 0 ? (totalMarket - totalInPlace) / totalMarket : 0;

  return {
    unit_count: total,
    parsed_unit_rows: units.length,
    occupied,
    vacant,
    notice,
    occupancy,
    total_market_rent: totalMarket,
    total_in_place_rent: totalInPlace,
    loss_to_lease: lossToLease,
    from_property_summary: !!summary,
    as_of_date: asOfDate,
  };
}

function trimCell(v: unknown): string | number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const s = String(v);
  return s.length > RAW_CELL_CAP ? s.slice(0, RAW_CELL_CAP) + "…" : s;
}

/** Detect the rent roll "as of" date from the top rows of a sheet. */
function detectAsOfDate(aoa: unknown[][]): string | null {
  const scanRows = aoa.slice(0, Math.min(15, aoa.length));
  for (const row of scanRows) {
    if (!row) continue;
    for (let i = 0; i < row.length; i++) {
      const cell = row[i];
      if (cell == null) continue;
      const text = String(cell).trim();
      if (!text) continue;
      if (/(as\s*of|report\s*date|run\s*date|rent\s*roll.*date|date\s*:?$)/i.test(text)) {
        const afterLabel = text
          .replace(/.*?(as\s*of|report\s*date|run\s*date|date)\s*:?\s*/i, "")
          .trim();
        const fromLabel = afterLabel ? toDate(afterLabel) : null;
        if (fromLabel) return fromLabel;
        for (let j = i + 1; j < row.length; j++) {
          const d = toDate(row[j]);
          if (d) return d;
        }
      }
      const m = text.match(/\b(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})\b/);
      if (m) {
        const d = toDate(m[1]);
        if (d) return d;
      }
    }
  }
  return null;
}

// ---------- PDF path ----------

async function parsePdf(buf: ArrayBuffer): Promise<RentRollParseResult> {
  const extraction = await extractPdfRentRoll(buf);
  if (!extraction || extraction.units.length === 0) {
    throw new Error(
      "Could not extract unit data from this PDF. Verify it is a standard rent roll report and try again.",
    );
  }

  const warnings: string[] = ["Parsed from PDF via AI extraction — review extracted data carefully."];
  const units: ParsedUnit[] = extraction.units.map((u) => ({
    unit_number: u.unit_number,
    floor_plan_code: u.floor_plan_code ?? null,
    beds: u.beds ?? null,
    baths: u.baths ?? null,
    square_feet: u.square_feet ?? null,
    market_rent: u.market_rent ?? null,
    in_place_rent: u.in_place_rent ?? null,
    status: u.status,
    resident_name: u.resident_name ?? null,
    lease_start: u.lease_start ?? null,
    lease_end: u.lease_end ?? null,
  }));

  if (units.some((u) => u.market_rent == null)) warnings.push("Some units are missing market rent.");
  if (units.some((u) => u.square_feet == null)) warnings.push("Some units are missing square footage.");

  const summary = extraction.property_summary ?? null;
  const asOfDate = extraction.as_of_date ?? null;
  if (summary && (summary.total_units ?? 0) !== units.length) {
    warnings.push(
      `Property summary reports ${summary.total_units} units; parsed ${units.length} unit rows.`,
    );
  }

  const stats = buildStats(units, summary, asOfDate);
  const floorplans = buildFloorplans(units);

  const PDF_HEADERS = [
    "Unit",
    "Type",
    "Sq Ft",
    "Market Rent",
    "In-Place Rent",
    "Status",
    "Resident Name",
    "Lease Start",
    "Lease End",
  ];
  const rawSheet: RawSheet = {
    sheet_name: "Extracted from PDF",
    total_rows: units.length + 1,
    truncated: false,
    rows: [
      PDF_HEADERS,
      ...units.map((u) => [
        u.unit_number,
        u.floor_plan_code,
        u.square_feet,
        u.market_rent,
        u.in_place_rent,
        u.status,
        u.resident_name,
        u.lease_start,
        u.lease_end,
      ]),
    ] as (string | number | null)[][],
  };

  return {
    units,
    floorplans,
    stats,
    warnings,
    rowFlags: [],
    mapping: null,
    parseMethod: "pdf_ai",
    asOfDate,
    rawSheet,
    fingerprint: null,
    headerLabels: [],
  };
}

// ---------- Excel/CSV path ----------

type SheetOutcome = {
  sheetName: string;
  aoa: unknown[][];
  units: ParsedUnit[];
  warnings: string[];
  flags: RowFlag[];
  lastUnitRow: number;
  mapping: AiMapping;
  parseMethod: ParseMethod;
  asOfDate: string | null;
};

async function parseWorkbook(buf: ArrayBuffer, input: ParseInput): Promise<RentRollParseResult> {
  const wb = XLSX.read(buf, { type: "array" });
  if (wb.SheetNames.length === 0) throw new Error("Workbook has no sheets");

  const formatMemory = input.formatMemory ?? new Map<string, string>();

  const sheetToAoa = (name: string): unknown[][] | null => {
    const sheet = wb.Sheets[name];
    if (!sheet) return null;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: true,
      blankrows: true,
    });
    return aoa.length > 0 ? aoa : null;
  };

  // Pass 1 — deterministic format replay (no AI). Skipped when the user typed
  // correction instructions — they're asking for a fresh AI mapping.
  const tryReplaySheet = (name: string): SheetOutcome | null => {
    const aoa = sheetToAoa(name);
    if (!aoa) return null;
    const replayed = findFormatReplay(aoa, formatMemory);
    if (!replayed) return null;
    const applied = applyMapping(aoa, replayed);
    if (!replayAcceptable(applied.units)) return null;
    applied.warnings.push("Columns mapped from a previously confirmed rent roll format (no AI needed).");
    return {
      sheetName: name,
      aoa,
      units: applied.units,
      warnings: applied.warnings,
      flags: applied.flags,
      lastUnitRow: applied.lastUnitRow,
      mapping: replayed,
      parseMethod: "format_replay",
      asOfDate: detectAsOfDate(aoa),
    };
  };

  // Pass 2 — AI mapper, heuristic fallback.
  const tryParseSheet = async (name: string): Promise<SheetOutcome | null> => {
    const aoa = sheetToAoa(name);
    if (!aoa) return null;

    let mapping = await callAiMapper(aoa, input.instructions, input.pastExamples);
    let method: ParseMethod = mapping ? "ai" : "heuristic";
    if (!mapping) mapping = heuristicMapping(aoa);

    let applied = applyMapping(aoa, mapping);
    const warnings = applied.warnings;

    if (applied.units.length === 0 && method === "ai") {
      const fallback = heuristicMapping(aoa);
      const retry = applyMapping(aoa, fallback);
      if (retry.units.length > 0) {
        mapping = fallback;
        method = "heuristic";
        applied = retry;
        warnings.push("AI mapping returned no rows; used heuristic fallback.");
        warnings.push(...retry.warnings);
      }
    }
    if (applied.units.length === 0) return null;
    return {
      sheetName: name,
      aoa,
      units: applied.units,
      warnings,
      flags: applied.flags,
      lastUnitRow: applied.lastUnitRow,
      mapping,
      parseMethod: method,
      asOfDate: detectAsOfDate(aoa),
    };
  };

  let outcome: SheetOutcome | null = null;
  if (!input.instructions && formatMemory.size > 0) {
    for (const name of wb.SheetNames) {
      const replayed = tryReplaySheet(name);
      if (replayed) {
        outcome = replayed;
        break;
      }
    }
  }

  const triedNames: string[] = [];
  if (!outcome) {
    const ranked = await rankRentRollSheets(wb);
    for (const name of ranked) {
      triedNames.push(name);
      const result = await tryParseSheet(name);
      if (result) {
        outcome = result;
        break;
      }
    }
  }
  if (!outcome) {
    const hint =
      wb.SheetNames.length > 1
        ? ` Tried sheet${triedNames.length === 1 ? "" : "s"}: ${triedNames.join(", ")}.`
        : "";
    throw new Error(
      `No unit rows detected.${hint} Check that the workbook has a Unit column on a rent roll tab.`,
    );
  }

  const { aoa, mapping, parseMethod, asOfDate, sheetName } = outcome;
  const warnings = outcome.warnings;
  let units = outcome.units;
  let flags = outcome.flags;

  if (parseMethod === "ai") warnings.unshift("Columns detected with AI assist.");
  if (wb.SheetNames.length > 1) warnings.unshift(`Parsed from sheet "${sheetName}".`);

  // Reconciliation target — the sheet's own occupancy summary.
  const summary =
    mapping.property_summary ?? detectSummaryFromTail(aoa, mapping, outcome.lastUnitRow + 1);

  // Count reconciliation: summary says more units than we parsed → rescan with
  // high blank tolerance to jump the gaps between split sections.
  if (summary?.total_units && units.length < summary.total_units) {
    const rescan = applyMapping(aoa, mapping, { blankTolerance: 12 });
    const unique = new Set(rescan.units.map((u) => u.unit_number));
    if (rescan.units.length === summary.total_units && unique.size === rescan.units.length) {
      warnings.push(
        `Recovered ${rescan.units.length - units.length} unit row(s) found after gaps in the sheet — now matches the summary total of ${summary.total_units}.`,
      );
      units = rescan.units;
      flags = rescan.flags;
    } else {
      warnings.push(
        `Summary reports ${summary.total_units} units but ${units.length} unit rows were parsed — ${summary.total_units - units.length} may be missing (split sections or truncated table).`,
      );
    }
  }
  if (summary?.total_units && units.length > summary.total_units) {
    warnings.push(
      `Parsed ${units.length} unit rows but the summary reports only ${summary.total_units} — extra rows may have been included.`,
    );
  }

  const stats = buildStats(units, summary, asOfDate);
  const floorplans = buildFloorplans(units);

  const rawSheet: RawSheet = {
    sheet_name: sheetName,
    total_rows: aoa.length,
    rows: aoa.slice(0, RAW_ROW_CAP).map((r) => (r ?? []).map(trimCell)),
    truncated: aoa.length > RAW_ROW_CAP,
  };

  const headerLabels = foldedHeaderLabels(aoa, mapping.header_row, mapping.data_start_row);
  const fingerprint = headerFingerprint(headerLabels);

  return {
    units,
    floorplans,
    stats,
    warnings,
    rowFlags: flags,
    mapping,
    parseMethod,
    asOfDate,
    rawSheet,
    fingerprint,
    headerLabels,
  };
}

/** Parse an uploaded rent-roll file into a structured result. */
export async function parseRentRoll(buf: ArrayBuffer, input: ParseInput = {}): Promise<RentRollParseResult> {
  if (isPdf(buf)) return parsePdf(buf);
  return parseWorkbook(buf, input);
}
