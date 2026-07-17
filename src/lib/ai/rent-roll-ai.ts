/**
 * AI-assisted rent-roll parsing: the Claude column mapper, the multi-sheet
 * picker, and native-PDF unit extraction. Ported from the DealCompass importer;
 * adapted to CM's direct Anthropic client (src/lib/ai/anthropic.ts).
 *
 * Server-only. Every call degrades gracefully (returns null) so the caller can
 * fall back to the deterministic heuristic mapper.
 */
import { z } from "zod";
import * as XLSX from "xlsx";
import { AiSchema, type AiMapping } from "@/lib/rent-roll-mapping";
import { anthropicMessage, hasAnthropicKey, parseJsonResponse } from "@/lib/ai/anthropic";

const JSON_SYSTEM = "You output strict JSON only, with no prose and no markdown fences.";

// ---------- Column mapper ----------

export async function callAiMapper(
  aoa: unknown[][],
  instructions?: string,
  pastExamples?: Array<{ raw_label: string; mapped_to: string }>,
): Promise<AiMapping | null> {
  if (!hasAnthropicKey()) return null;

  // Build a compact sample: first 25 non-empty rows + a middle slice + last 40.
  // Truncate cells so the prompt stays small.
  const trim = (v: unknown) => {
    if (v == null) return null;
    const s = String(v);
    return s.length > 60 ? s.slice(0, 60) + "…" : s;
  };
  const indexed = aoa.map((r, i) => [i, ...r.map(trim)]);
  const nonEmpty = indexed.filter((r) => r.slice(1).some((c) => c != null && c !== ""));
  const head = nonEmpty.slice(0, 25);
  const midStart = Math.max(25, Math.floor(nonEmpty.length / 2) - 5);
  const mid = nonEmpty.slice(midStart, midStart + 10);
  const tail = nonEmpty.slice(-40);
  const sample = [...head, ...mid, ...tail];

  const prompt = `You are parsing a multifamily property rent roll spreadsheet. Each row below is prefixed with its 0-indexed row number, followed by raw cell values from the XLSX. Cells may be null due to merged headers.

Return a JSON object describing how to parse it:
- header_row: 0-indexed row containing column labels. HEADERS ARE OFTEN SPLIT ACROSS TWO ROWS (e.g. row 4 has "Market | Charge | Amount" and row 5 has "Rent | Code | <blank>" — together they mean "Market Rent | Charge Code | Amount"). Pick the FIRST row of the header block; the importer will fold in the next row automatically.
- data_start_row: 0-indexed row where the first actual unit row appears. Skip past sub-header rows and section banner rows (e.g. "Current/Notice/Vacant Residents").
- data_end_row: 0-indexed row number of the LAST individual unit row before any totals/summary/"Future Residents/Applicants"/"Property Occupancy" section. Critical: rent rolls typically have one large contiguous unit table followed by rollup tables — data_end_row must be the last unit row of that main table, NOT the end of file. If the file truly ends with units, return null.
- columns: 0-indexed column numbers for each field, or null if not present.
  - unit_number: the apartment number (e.g. "0111", "A-203"). Required.
  - resident_name: prefer a column literally labelled "Name" / "Resident Name" / "Tenant Name". Skip a column that is just "Resident" if it looks like an ID (e.g. "t0055016") — that is a resident ID, not the name.
  - market_rent: column for the unit's posted market/asking rent.
  - in_place_rent: actual rent the resident is paying. For a normal single-row-per-unit rent roll, pick the column with that header. For a "Rent Roll with Lease Charges" export, set in_place_rent to the Amount column — but ALSO populate charge_code and amount (see below) so the importer can grab the Amount on the sub-row whose charge code is literally "rent".
  - charge_code (lease-charges format only): column where each row's charge type appears ("rent", "trash", "tpest", "petrent", "drainfee", "carport", "gigextra", etc.). Set null when the workbook doesn't have this pattern.
  - amount (lease-charges format only): paired Amount column for the charge_code. Set null when not applicable.
  - lease_start: column for the move-IN date. Look for headers: "Move In", "Move-In Date", "Move In Date", "Lease Start", "Lease Begin", "Start Date", "Lease From", "Lease Date". Date cells may be Excel serial integers (e.g. 45443 ≈ 2024-06-26) — identify by header, not by cell format.
  - lease_end: column for the lease EXPIRATION / move-OUT date. Look for headers: "Lease Expiration", "Expiration", "Expiration Date", "Lease End", "Lease To", "End Date", "Move Out", "Move-Out Date", "Lease Thru". It is usually adjacent to lease_start. Date cells may be Excel serial integers — identify by header.
- status_map: map raw status codes (e.g. "C","R","NTV","V","F","UE","Vacant") to one of: "occupied","notice","vacant","future".
- plan_map: map each unique floor-plan / unit-type string to inferred {beds,baths} (e.g. "Texas Palm Classic" might be a 2BR/1BA — only fill if confidently inferable from name; otherwise omit).
- vacant_resident_markers: substrings in the resident column that indicate vacancy (e.g. "Vacant", "VACANT", "Vacant Unit*").
- property_summary: if the sheet contains a "Property Occupancy" / summary / totals section, extract: total_units, occupied_units, vacant_units, notice_units, occupancy_pct (as decimal, e.g. 0.915). Use null for any value not stated. Set the whole field to null if no summary is present.

IMPORTANT: Some rent rolls put each unit on a single row. Others (PM systems like Yardi/MRI with "Lease Charges" exports) put one main row per unit followed by 3-6 sub-rows listing individual charge codes (rent, trash, pest, etc.) with the unit cell blank. The importer treats rows with a blank unit_number as charge breakdown and skips them — your job is just to pick the right unit_number column.

Output ONLY valid JSON, no prose, no markdown fences.
${pastExamples && pastExamples.length > 0 ? `\nPAST CONFIRMED COLUMN MAPPINGS (from rent rolls you have already validated — treat these as strong hints when header text is the same or similar):\n${pastExamples.map((e) => `"${e.raw_label}" → ${e.mapped_to}`).join("\n")}\n` : ""}${instructions ? `\nUSER CORRECTION INSTRUCTIONS (apply these when mapping columns):\n${instructions}\n` : ""}
DATA SAMPLE:
${JSON.stringify(sample)}`;

  try {
    const content = await anthropicMessage([{ role: "user", content: prompt }], {
      system: JSON_SYSTEM,
      maxTokens: 4096,
    });
    const parsed = AiSchema.safeParse(parseJsonResponse(content));
    if (!parsed.success) {
      console.error("AI mapping schema mismatch", parsed.error);
      return null;
    }
    return parsed.data;
  } catch (e) {
    console.error("AI mapper error", e);
    return null;
  }
}

// ---------- Sheet picker (multi-sheet workbooks) ----------

const AiSheetPickSchema = z.object({
  sheet_name: z.string().nullable(),
  confidence: z.number().min(0).max(1).optional(),
});

async function callAiSheetPicker(
  samples: { name: string; rows: (string | null)[][] }[],
): Promise<string | null> {
  if (!hasAnthropicKey()) return null;
  const prompt = `You are inspecting a multi-sheet Excel workbook to find the sheet that contains a multifamily rent roll. A rent roll has one row per unit/apartment with columns like Unit, Floor Plan, Resident/Tenant, Lease Dates, Market Rent, In-Place Rent, Status (occupied/vacant/notice), Sq Ft, etc.

Other sheets in this workbook may include cover pages, summaries, occupancy rollups, market comps, or charts. Skip those.

Below is each sheet's name plus the first ~10 rows. Return strict JSON:
{ "sheet_name": "<name of the rent roll sheet>" | null, "confidence": 0..1 }

If no sheet looks like an actual rent roll, return { "sheet_name": null, "confidence": 0 }.

WORKBOOK:
${JSON.stringify(samples)}`;

  try {
    const content = await anthropicMessage([{ role: "user", content: prompt }], {
      system: JSON_SYSTEM,
      maxTokens: 512,
    });
    const parsed = AiSheetPickSchema.safeParse(parseJsonResponse(content));
    if (!parsed.success) return null;
    return parsed.data.sheet_name;
  } catch (e) {
    console.error("AI sheet picker error", e);
    return null;
  }
}

/** Heuristic + AI ranked list of which sheets to try for rent roll data.
 *  Always returns at least one sheet name (defaults to sheet 0 if all fails). */
export async function rankRentRollSheets(wb: XLSX.WorkBook): Promise<string[]> {
  const all = wb.SheetNames;
  if (all.length === 1) return all;

  // 1. Heuristic by sheet name — strong signals first.
  const named = (rx: RegExp) => all.filter((n) => rx.test(n));
  const tier1 = named(/rent[\s_-]*roll/i);
  const tier2 = named(/detail|occupancy|residents?|tenant/i);
  const tier3 = named(/^(?!.*(summary|cover|chart|comp|graph)).+/i);

  // 2. AI pick from short samples of each sheet.
  const samples = all.map((name) => {
    const sheet = wb.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: true,
      blankrows: true,
    });
    const trim = (v: unknown) => {
      if (v == null) return null;
      const s = String(v);
      return s.length > 50 ? s.slice(0, 50) + "…" : s;
    };
    const rows = aoa.slice(0, 10).map((r) => r.map(trim));
    return { name, rows };
  });

  const aiPick = await callAiSheetPicker(samples);

  // 3. Order: AI pick first (if any), then heuristic tiers, then any remaining.
  const ranked: string[] = [];
  const push = (n: string) => {
    if (!ranked.includes(n)) ranked.push(n);
  };
  if (aiPick && all.includes(aiPick)) push(aiPick);
  for (const n of tier1) push(n);
  for (const n of tier2) push(n);
  for (const n of tier3) push(n);
  for (const n of all) push(n); // catch-all
  return ranked;
}

// ---------- PDF extraction (native document block) ----------

export const PdfExtractionSchema = z.object({
  as_of_date: z.string().nullable().optional(),
  units: z.array(
    z.object({
      unit_number: z.string().min(1),
      floor_plan_code: z.string().nullable().optional(),
      beds: z.number().nullable().optional(),
      baths: z.number().nullable().optional(),
      square_feet: z.number().nullable().optional(),
      market_rent: z.number().nullable().optional(),
      in_place_rent: z.number().nullable().optional(),
      status: z.enum(["occupied", "notice", "vacant", "future"]).default("vacant"),
      resident_name: z.string().nullable().optional(),
      lease_start: z.string().nullable().optional(),
      lease_end: z.string().nullable().optional(),
    }),
  ),
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
});

export type PdfExtraction = z.infer<typeof PdfExtractionSchema>;

const PDF_EXTRACTOR_PROMPT = `You are extracting apartment unit data from a multifamily rent roll PDF.

Extract ALL individual apartment unit entries. For each unit return:
- unit_number: apartment identifier (e.g. "101", "A-203"). REQUIRED.
- floor_plan_code: plan name / type (e.g. "2BR/1BA", "A", "Texas Palm") or null
- beds: integer or null
- baths: number or null
- square_feet: number or null
- market_rent: posted asking rent ($/month) or null
- in_place_rent: actual rent charged ($/month) or null
- status: "occupied" | "notice" | "vacant" | "future"
- resident_name: tenant full name, or null if vacant
- lease_start: lease start / move-in date as YYYY-MM-DD or null
- lease_end: lease expiration date as YYYY-MM-DD or null

Also extract:
- as_of_date: the report "as of" date as YYYY-MM-DD or null
- property_summary: { total_units, occupied_units, vacant_units, notice_units, occupancy_pct } from the summary/totals section, or null

Skip all header rows, section labels, subtotals, and non-unit rows. Only return rows that represent real apartment units.
Return strict JSON only, no markdown fences: { "as_of_date": "...", "units": [...], "property_summary": {...} }`;

/** Extract units from a rent-roll PDF via Claude's native document block.
 *  Returns null (never throws) so the caller can surface a clean error. */
export async function extractPdfRentRoll(pdfBuffer: ArrayBuffer): Promise<PdfExtraction | null> {
  if (!hasAnthropicKey()) return null;
  const bytes = new Uint8Array(pdfBuffer);
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, Math.min(i + CHUNK, bytes.length))));
  }
  const pdfBase64 = btoa(binary);

  try {
    const content = await anthropicMessage(
      [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
            },
            { type: "text", text: PDF_EXTRACTOR_PROMPT },
          ],
        },
      ],
      { maxTokens: 16384, pdf: true },
    );
    const parsed = PdfExtractionSchema.safeParse(parseJsonResponse(content));
    if (!parsed.success) {
      console.error("PDF schema mismatch", parsed.error);
      return null;
    }
    return parsed.data;
  } catch (e) {
    console.error("PDF extraction error", e);
    return null;
  }
}
