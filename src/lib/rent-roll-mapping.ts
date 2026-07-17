/**
 * Rent roll mapping engine — pure logic, no AI calls, no I/O.
 *
 * Everything deterministic about turning a spreadsheet into ParsedUnit[] lives
 * here: the mapping schema, the keyword-heuristic column detector, the row
 * extractor (applyMapping), whole-format mapping memory (fingerprint → replay),
 * and occupancy-summary detection. rent-roll-import.ts orchestrates these with
 * the AI mapper and the DB. Ported from the DealCompass rent roll importer.
 */
import { z } from "zod";
import { inferBedsFromPlan } from "@/lib/floorplan-beds";

export type ParsedUnit = {
  unit_number: string;
  floor_plan_code: string | null;
  beds: number | null;
  baths: number | null;
  square_feet: number | null;
  market_rent: number | null;
  in_place_rent: number | null;
  status: "occupied" | "notice" | "vacant" | "future";
  resident_name: string | null;
  lease_start: string | null;
  lease_end: string | null;
};

export type FieldKey = keyof Omit<ParsedUnit, "status"> | "status";

// ---------- helpers ----------

export function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function toDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    // Excel serial date → JS Date (epoch 1899-12-30, accounting for 1900 leap bug)
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export function rowIsBlank(r: unknown[]): boolean {
  return r.every((c) => c == null || String(c).trim() === "");
}

// ---------- Mapping schema (shared with the AI mapper) ----------

export const AiSchema = z.object({
  header_row: z.number().int().min(0),
  data_start_row: z.number().int().min(0),
  data_end_row: z.number().int().min(0).nullable().optional(),
  columns: z.object({
    unit_number: z.number().int().nullable(),
    floor_plan_code: z.number().int().nullable(),
    beds: z.number().int().nullable(),
    baths: z.number().int().nullable(),
    square_feet: z.number().int().nullable(),
    market_rent: z.number().int().nullable(),
    in_place_rent: z.number().int().nullable(),
    status: z.number().int().nullable(),
    resident_name: z.number().int().nullable(),
    lease_start: z.number().int().nullable(),
    lease_end: z.number().int().nullable(),
    // Lease-charges format only: the column that holds the charge code
    // ("rent", "trash", "pest", "petrent", "drainfee", "carport", etc.) and
    // the corresponding amount column. When present, in_place_rent is
    // computed by finding the row in this unit's group whose charge_code
    // equals "rent" and reading its amount.
    charge_code: z.number().int().nullable().optional(),
    amount: z.number().int().nullable().optional(),
  }),
  status_map: z.record(z.string(), z.enum(["occupied", "notice", "vacant", "future"])).default({}),
  plan_map: z
    .record(
      z.string(),
      z.object({
        beds: z.number().nullable().optional(),
        baths: z.number().nullable().optional(),
      }),
    )
    .default({}),
  vacant_resident_markers: z.array(z.string()).default([]),
  property_summary: z
    .object({
      total_units: z.number().nullable().optional(),
      occupied_units: z.number().nullable().optional(),
      vacant_units: z.number().nullable().optional(),
      notice_units: z.number().nullable().optional(),
      occupancy_pct: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  notes: z.string().optional(),
});

export type AiMapping = z.infer<typeof AiSchema>;

// ---------- Heuristic column detection ----------

const HEURISTIC_HEADERS: Record<Exclude<FieldKey, "status">, string[]> = {
  unit_number: ["unit", "unit number", "unit #", "apt"],
  floor_plan_code: ["floor plan", "plan", "unit type", "type"],
  beds: ["beds", "bed", "bedrooms", "br"],
  baths: ["baths", "bath", "bathrooms", "ba"],
  square_feet: ["sqft", "sq ft", "square feet", "sf", "sq. feet"],
  market_rent: ["market rent", "market", "asking rent"],
  in_place_rent: ["actual rent", "in place rent", "lease rent", "rent", "current rent"],
  resident_name: ["resident", "tenant", "name", "residents"],
  lease_start: [
    "lease start",
    "move in",
    "move-in",
    "move in date",
    "start date",
    "lease from",
    "lease begin",
    "lease date",
  ],
  lease_end: [
    "lease end",
    "lease expiration",
    "expiration",
    "expiration date",
    "move out",
    "move-out",
    "move out date",
    "end date",
    "lease to",
    "lease thru",
  ],
};

export function heuristicMapping(aoa: unknown[][]): AiMapping {
  // Find header row: scan first 20 rows, pick the one with the most matches.
  // For each candidate row, also fold in the next row so multi-row headers
  // like "Market" / "Rent" or "Unit" / "Sq Ft" register correctly.
  const norm = (s: unknown) =>
    String(s ?? "")
      .trim()
      .toLowerCase();
  const combined = (rowA: unknown[], rowB: unknown[] | undefined): string[] => {
    const a = (rowA ?? []).map(norm);
    const b = (rowB ?? []).map(norm);
    const n = Math.max(a.length, b.length);
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const va = a[i] ?? "";
      const vb = b[i] ?? "";
      out.push([va, vb].filter(Boolean).join(" ").trim());
    }
    return out;
  };

  let bestRow = 0;
  let bestScore = -1;
  let bestHeader: string[] = [];
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const merged = combined(aoa[i] ?? [], aoa[i + 1]);
    let score = 0;
    for (const aliases of Object.values(HEURISTIC_HEADERS)) {
      if (merged.some((c) => aliases.some((a) => c === a || c.includes(a)))) score++;
    }
    if (merged.some((c) => c.includes("status"))) score++;
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
      bestHeader = merged;
    }
  }
  const header = bestHeader;

  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wordMatch = (hay: string, needle: string) =>
    new RegExp(`\\b${escapeRe(needle)}\\b`).test(hay);

  const findCol = (aliases: string[]) => {
    // Exact match first, then word-boundary substring (so "ba" doesn't match
    // "balance" and "br" doesn't grab some unrelated column).
    for (let i = 0; i < header.length; i++) {
      if (aliases.some((a) => header[i] === a)) return i;
    }
    for (let i = 0; i < header.length; i++) {
      if (aliases.some((a) => wordMatch(header[i], a))) return i;
    }
    return null;
  };

  // Resident name: prefer a column literally called "name" / "resident name" /
  // "tenant" over one that's just "resident" (which is usually a resident ID).
  const findResidentName = () => {
    const exact = findCol(["resident name", "tenant name", "name"]);
    if (exact != null) return exact;
    return findCol(["resident", "tenant", "residents"]);
  };

  // In-place rent: prefer specific labels; "amount" is a common fallback for
  // PM-system "Rent Roll with Lease Charges" exports where the unit's row holds
  // the actual rent in an Amount column with Charge Code = "rent". Exclude any
  // column already claimed as market_rent so we don't double-map.
  const findInPlaceRent = (excludeIdx: number | null): number | null => {
    const findExcluding = (aliases: string[]) => {
      for (let i = 0; i < header.length; i++) {
        if (i === excludeIdx) continue;
        if (aliases.some((a) => wordMatch(header[i], a))) return i;
      }
      return null;
    };
    const explicit = findExcluding([
      "actual rent",
      "in place rent",
      "in-place rent",
      "lease rent",
      "current rent",
      "scheduled rent",
    ]);
    if (explicit != null) return explicit;
    const generic = findExcluding(["rent"]);
    if (generic != null) return generic;
    return findExcluding(["amount"]);
  };

  // Heuristic data_start_row: skip the second header row when we folded one in.
  // If the next row appears to be all sub-header text (mostly short labels and
  // no numeric values), advance past it.
  let dataStart = bestRow + 1;
  const nextRow = aoa[dataStart] ?? [];
  const nextHasNumber = nextRow.some(
    (c) => typeof c === "number" || (typeof c === "string" && /^\s*\d/.test(c)),
  );
  const nextNonEmpty = nextRow.filter((c) => c != null && String(c).trim() !== "");
  if (!nextHasNumber && nextNonEmpty.length > 0 && nextNonEmpty.length < nextRow.length / 2) {
    dataStart += 1;
  }

  const marketRentCol = findCol(HEURISTIC_HEADERS.market_rent);
  const chargeCodeCol = findCol(["charge code", "charge", "code"]);
  const amountCol = findCol(["amount"]);

  // When a charge_code column is present, in_place_rent must come from the
  // sub-row whose code is "rent" (handled in applyMapping), so we route the
  // in_place_rent column to amount in that case.
  let inPlaceRentCol: number | null;
  if (chargeCodeCol != null && amountCol != null) {
    inPlaceRentCol = amountCol;
  } else {
    inPlaceRentCol = findInPlaceRent(marketRentCol);
  }

  return {
    header_row: bestRow,
    data_start_row: dataStart,
    data_end_row: null,
    columns: {
      unit_number: findCol(HEURISTIC_HEADERS.unit_number),
      floor_plan_code: findCol(HEURISTIC_HEADERS.floor_plan_code),
      beds: findCol(HEURISTIC_HEADERS.beds),
      baths: findCol(HEURISTIC_HEADERS.baths),
      square_feet: findCol(HEURISTIC_HEADERS.square_feet),
      market_rent: marketRentCol,
      in_place_rent: inPlaceRentCol,
      status: findCol(["status"]),
      resident_name: findResidentName(),
      lease_start: findCol(HEURISTIC_HEADERS.lease_start),
      lease_end: findCol(HEURISTIC_HEADERS.lease_end),
      charge_code: chargeCodeCol,
      amount: amountCol,
    },
    status_map: {
      C: "occupied",
      c: "occupied",
      current: "occupied",
      occupied: "occupied",
      R: "occupied",
      r: "occupied",
      renewal: "occupied",
      NTV: "notice",
      ntv: "notice",
      notice: "notice",
      N: "notice",
      V: "vacant",
      v: "vacant",
      vacant: "vacant",
      VAC: "vacant",
      F: "future",
      f: "future",
      future: "future",
      applicant: "future",
      UE: "occupied",
    },
    plan_map: {},
    vacant_resident_markers: ["vacant", "vacant unit", "vacant unit*"],
  };
}

// ---------- Apply mapping ----------

/** Per-row extraction caveat — a value the importer had to guess at. Surfaced
 *  on the review sheet so guessed rows get a human eye instead of blending in. */
export type RowFlag = {
  unit_number: string;
  flag: "status_defaulted" | "rent_from_largest_charge";
  detail: string;
};
const MAX_ROW_FLAGS = 80;

export function applyMapping(
  aoa: unknown[][],
  m: AiMapping,
  opts?: { blankTolerance?: number },
): { units: ParsedUnit[]; warnings: string[]; flags: RowFlag[]; lastUnitRow: number } {
  const warnings: string[] = [];
  const flags: RowFlag[] = [];
  const unmappedStatusCodes = new Map<string, number>();
  // Sheet row index of the last accepted unit — summary detection scans after it.
  let lastUnitRow = -1;
  // How many consecutive blank rows end the table. The count-reconciliation
  // rescan raises this to jump the gaps between split sections
  // (Current / Notice / Vacant residents).
  const blankTolerance = opts?.blankTolerance ?? 2;
  const c = m.columns;
  if (c.unit_number == null) {
    warnings.push("Could not detect a Unit column.");
    return { units: [], warnings, flags, lastUnitRow };
  }

  const start = m.data_start_row;
  const end = m.data_end_row != null ? Math.min(m.data_end_row, aoa.length - 1) : aoa.length - 1;
  const vacantMarkers = m.vacant_resident_markers.map((s) => s.toLowerCase());

  const get = (row: unknown[], col: number | null) => (col == null ? null : (row[col] ?? null));

  const units: ParsedUnit[] = [];
  let blankStreak = 0;
  for (let i = start; i <= end; i++) {
    const row = aoa[i];
    if (!row || rowIsBlank(row)) {
      blankStreak++;
      // After we've collected units, enough consecutive blank rows means the main table is done
      if (units.length > 0 && blankStreak >= blankTolerance) break;
      continue;
    }
    blankStreak = 0;

    // If ANY cell in the row signals an END-OF-REPORT banner, stop. Note: we
    // deliberately do NOT match plain "total" / "subtotal" here, because
    // "Rent Roll with Lease Charges" exports put a per-unit "Total" sub-row
    // (rent + charges) between every unit, which would falsely terminate the
    // loop after the first unit if we matched on it.
    const rowText = row
      .map((v) => String(v ?? "").trim())
      .join(" | ")
      .toLowerCase();
    if (
      units.length > 0 &&
      /(^|\s|\|)\s*(grand\s+total|report\s+total|summary|property\s+occupancy|future\s+residents|applicants|occupancy\s+summary|lease\s+expirations?)\b/.test(
        rowText,
      )
    ) {
      break;
    }

    const unitRaw = get(row, c.unit_number);
    if (unitRaw == null || unitRaw === "") continue;
    const unit_number = String(unitRaw).trim();
    if (!unit_number) continue;
    if (/^(total|summary|subtotal|grand total)/i.test(unit_number)) {
      if (units.length > 0) break;
      continue;
    }
    // Skip rows where unit isn't a plausible identifier
    if (unit_number.length > 20) continue;

    const planRaw = get(row, c.floor_plan_code);
    const floor_plan_code = planRaw ? String(planRaw).trim() : null;

    let beds = toNumber(get(row, c.beds));
    let baths = toNumber(get(row, c.baths));
    if ((beds == null || baths == null) && floor_plan_code) {
      // First: use AI's explicit plan_map (most authoritative).
      const inferred = m.plan_map[floor_plan_code];
      if (inferred) {
        if (beds == null && inferred.beds != null) beds = inferred.beds;
        if (baths == null && inferred.baths != null) baths = inferred.baths;
      }
      // Second: infer from the code itself — letter convention (A=1BR, B=2BR…)
      // and "NxM" notation (e.g. "2x1" = 2 beds / 1 bath).
      if (beds == null || baths == null) {
        const codeInferred = inferBedsFromPlan(floor_plan_code);
        if (beds == null && codeInferred.beds != null) beds = codeInferred.beds;
        if (baths == null && codeInferred.baths != null) baths = codeInferred.baths;
      }
    }

    const square_feet = toNumber(get(row, c.square_feet));
    const market_rent = toNumber(get(row, c.market_rent));

    // In-place rent. Default: read directly from the unit's row.
    // BUT — for "Rent Roll with Lease Charges" exports the unit's main row
    // holds whichever charge code happens to appear first (drainfee, carport,
    // rent, etc.), and additional charges live on sub-rows beneath. Walk the
    // unit's group of rows and pick the amount where charge_code === "rent".
    let in_place_rent: number | null = toNumber(get(row, c.in_place_rent));
    if (c.charge_code != null && c.amount != null) {
      let rentAmt: number | null = null;
      let largestAmt: number | null = null;
      // First check this row's own charge code:
      const myCode = String(get(row, c.charge_code) ?? "")
        .trim()
        .toLowerCase();
      const myAmt = toNumber(get(row, c.amount));
      if (myCode === "rent") rentAmt = myAmt;
      if (myAmt != null && (largestAmt == null || myAmt > largestAmt)) largestAmt = myAmt;
      // Then look ahead until the next unit row or 2 consecutive blank rows.
      let j = i + 1;
      let blanks = 0;
      while (j <= end) {
        const sub = aoa[j];
        if (!sub || rowIsBlank(sub)) {
          blanks++;
          if (blanks >= 2) break;
          j++;
          continue;
        }
        blanks = 0;
        const subUnit = get(sub, c.unit_number);
        if (subUnit != null && String(subUnit).trim() !== "") break; // hit next unit
        const subCode = String(get(sub, c.charge_code) ?? "")
          .trim()
          .toLowerCase();
        const subAmt = toNumber(get(sub, c.amount));
        // Stop scanning charges once we hit the per-unit Total banner.
        if (/^total$/i.test(subCode)) break;
        if (rentAmt == null && subCode === "rent") rentAmt = subAmt;
        if (subAmt != null && (largestAmt == null || subAmt > largestAmt)) largestAmt = subAmt;
        j++;
      }
      // Use the explicit rent line; fall back to the largest charge in the
      // group only as a last resort (rent is almost always the largest).
      if (rentAmt != null) in_place_rent = rentAmt;
      else if (largestAmt != null) {
        in_place_rent = largestAmt;
        if (flags.length < MAX_ROW_FLAGS) {
          flags.push({
            unit_number,
            flag: "rent_from_largest_charge",
            detail: `No "rent" charge line found — in-place rent taken from the largest charge ($${largestAmt}).`,
          });
        }
      }
    }

    const residentRaw = get(row, c.resident_name);
    const residentStr = residentRaw ? String(residentRaw).trim() : "";
    const residentLower = residentStr.toLowerCase();
    const isVacantByResident = vacantMarkers.some((mk) => mk && residentLower.includes(mk));

    const statusRaw = get(row, c.status);
    let status: ParsedUnit["status"] = "vacant";
    if (isVacantByResident) status = "vacant";
    else if (statusRaw != null && statusRaw !== "") {
      const key = String(statusRaw).trim();
      const mapped =
        m.status_map[key] ?? m.status_map[key.toLowerCase()] ?? m.status_map[key.toUpperCase()];
      if (mapped) status = mapped;
      else {
        // Unrecognized status code — the rent-based default is a guess that
        // directly moves occupancy, so it must be flagged, never silent.
        status = in_place_rent && in_place_rent > 0 ? "occupied" : "vacant";
        unmappedStatusCodes.set(key, (unmappedStatusCodes.get(key) ?? 0) + 1);
        if (flags.length < MAX_ROW_FLAGS) {
          flags.push({
            unit_number,
            flag: "status_defaulted",
            detail: `Status code "${key}" not recognized — defaulted to "${status}" based on rent.`,
          });
        }
      }
    } else {
      status = in_place_rent && in_place_rent > 0 ? "occupied" : "vacant";
    }

    units.push({
      unit_number,
      floor_plan_code,
      beds,
      baths,
      square_feet,
      market_rent,
      in_place_rent,
      status,
      resident_name: isVacantByResident ? null : residentStr || null,
      lease_start: toDate(get(row, c.lease_start)),
      lease_end: toDate(get(row, c.lease_end)),
    });
    lastUnitRow = i;
  }

  if (c.market_rent == null) warnings.push("Market rent column not detected.");
  if (c.in_place_rent == null) warnings.push("In-place rent column not detected.");
  if (c.square_feet == null) warnings.push("Square feet column not detected.");
  if (unmappedStatusCodes.size > 0) {
    const total = [...unmappedStatusCodes.values()].reduce((s, n) => s + n, 0);
    const codes = [...unmappedStatusCodes.keys()].slice(0, 10).join('", "');
    warnings.push(
      `${total} unit(s) had unrecognized status code(s) "${codes}" — status was inferred from rent. Occupancy may be off; re-parse with instructions if wrong.`,
    );
  }
  const rentFallbacks = flags.filter((f) => f.flag === "rent_from_largest_charge").length;
  if (rentFallbacks > 0) {
    warnings.push(
      `${rentFallbacks} unit(s) had no explicit "rent" charge line — in-place rent taken from the largest charge in the unit's group.`,
    );
  }

  return { units, warnings, flags, lastUnitRow };
}

// ---------- Whole-format mapping memory ----------
//
// When the user confirms a rent roll, we fingerprint its header row and store
// the COMPLETE mapping (columns, status codes, vacant markers) keyed by that
// fingerprint. A future upload whose header layout matches replays the saved
// mapping verbatim and skips every AI call — same PM-software export, same
// deterministic parse. Property-specific fields (plan_map, property_summary)
// never transfer between files.

/** Combine a header row with the row beneath it — headers are often split
 *  across two rows ("Market" / "Rent"). Folds only when the data doesn't start
 *  immediately after the header row. */
export function foldedHeaderLabels(
  rows: unknown[][],
  headerRow: number,
  dataStartRow: number,
): string[] {
  const a = (rows[headerRow] ?? []).map((c) => String(c ?? "").trim());
  const foldNext = dataStartRow > headerRow + 1;
  const b = foldNext ? (rows[headerRow + 1] ?? []).map((c) => String(c ?? "").trim()) : [];
  const n = Math.max(a.length, b.length);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push([a[i] ?? "", b[i] ?? ""].filter(Boolean).join(" ").trim());
  return out;
}

/** Stable fingerprint of a header layout — the mapping-memory key. Returns
 *  null for rows that can't be a real header (fewer than 3 labels). */
export function headerFingerprint(labels: string[]): string | null {
  const norm = labels.map((l) => l.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  const nonEmpty = norm.filter(Boolean);
  if (nonEmpty.length < 3) return null;
  const joined = norm.join("|");
  let h = 5381;
  for (let i = 0; i < joined.length; i++) h = (((h << 5) + h) ^ joined.charCodeAt(i)) >>> 0;
  return `rrfmt1:${h.toString(36)}:${nonEmpty.length}`;
}

/** Scan a sheet's candidate header rows against saved format fingerprints.
 *  On a hit, return the saved mapping re-anchored to where the header actually
 *  sits in THIS file (preamble length varies between exports). */
export function findFormatReplay(
  aoa: unknown[][],
  formats: Map<string, string>, // fingerprint → mapping JSON, newest first wins
): AiMapping | null {
  if (formats.size === 0) return null;
  const maxScan = Math.min(aoa.length, 25);
  for (let r = 0; r < maxScan; r++) {
    // Try both layouts: single-row header (data starts at r+1) and two-row
    // folded header (data starts at r+2) — matching how the format was saved.
    for (const labels of [foldedHeaderLabels(aoa, r, r + 1), foldedHeaderLabels(aoa, r, r + 2)]) {
      const fp = headerFingerprint(labels);
      if (!fp) continue;
      const json = formats.get(fp);
      if (!json) continue;
      let saved: AiMapping;
      try {
        const parsed = AiSchema.safeParse(JSON.parse(json));
        if (!parsed.success) continue;
        saved = parsed.data;
      } catch {
        continue;
      }
      const offset = r - saved.header_row;
      return {
        ...saved,
        header_row: r,
        data_start_row: saved.data_start_row + offset,
        data_end_row: null, // end position is file-specific; banner/blank detection finds it
        plan_map: {}, // another property's plan → beds inference must not transfer
        property_summary: null, // another file's occupancy counts must not transfer
      };
    }
  }
  return null;
}

/** Gate for accepting a replayed mapping without AI: the parse must look like
 *  a healthy rent roll, not a misfire on a lookalike sheet. */
export function replayAcceptable(units: ParsedUnit[]): boolean {
  if (units.length < 2) return false;
  const ids = new Set(units.map((u) => u.unit_number));
  if (ids.size !== units.length) return false;
  const plausible = units.filter(
    (u) => u.market_rent != null || u.in_place_rent != null || u.status === "vacant",
  ).length;
  return plausible / units.length >= 0.7;
}

// ---------- Deterministic occupancy-summary detection ----------

export type DetectedSummary = {
  total_units: number;
  occupied_units?: number | null;
  vacant_units?: number | null;
  notice_units?: number | null;
  occupancy_pct?: number | null;
};

/** Find the sheet's own "Property Occupancy" style summary without AI — it's
 *  the reconciliation target ("summary says 296, we parsed 292"). Scans only
 *  rows AFTER the last parsed unit (`fromRow`) so unit-data cells like a
 *  "Notice" status next to a rent amount can't masquerade as summary lines. */
export function detectSummaryFromTail(
  aoa: unknown[][],
  m: AiMapping,
  fromRow: number,
): DetectedSummary | null {
  const out: Partial<
    Record<
      "total_units" | "occupied_units" | "vacant_units" | "notice_units" | "occupancy_pct",
      number
    >
  > = {};
  const numAfter = (row: unknown[], fromCol: number): number | null => {
    for (let j = fromCol + 1; j < row.length; j++) {
      const n = toNumber(row[j]);
      if (n != null) return n;
    }
    return null;
  };
  for (let i = Math.max(fromRow, m.data_start_row); i < aoa.length; i++) {
    const row = aoa[i];
    if (!row || rowIsBlank(row)) continue;
    for (let col = 0; col < row.length; col++) {
      const cell = row[col];
      if (cell == null) continue;
      const t = String(cell).trim().toLowerCase();
      if (!t || t.length > 40) continue;
      if (out.total_units == null && /^total\s+(units?|apartments?)\b/.test(t)) {
        const n = numAfter(row, col);
        if (n != null && n > 0 && n < 20000) out.total_units = n;
      } else if (out.occupied_units == null && /occupied/.test(t) && !/unoccupied/.test(t)) {
        const n = numAfter(row, col);
        if (n != null && n >= 0 && n < 20000) out.occupied_units = n;
      } else if (out.vacant_units == null && /^vacant\b|vacant\s+units?/.test(t)) {
        const n = numAfter(row, col);
        if (n != null && n >= 0 && n < 20000) out.vacant_units = n;
      } else if (out.notice_units == null && /notice/.test(t)) {
        const n = numAfter(row, col);
        if (n != null && n >= 0 && n < 20000) out.notice_units = n;
      } else if (out.occupancy_pct == null && /occupancy/.test(t)) {
        const n = numAfter(row, col);
        if (n != null && n >= 0 && n <= 100) out.occupancy_pct = n > 1 ? n / 100 : n;
      }
    }
  }
  if (out.total_units == null) return null; // total is the only field we reconcile against
  // Sanity: a sub-count larger than the total is a mismatched grab — drop it.
  for (const k of ["occupied_units", "vacant_units", "notice_units"] as const) {
    if (out[k] != null && out[k]! > out.total_units) delete out[k];
  }
  return out as DetectedSummary;
}
