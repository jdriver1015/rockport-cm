/**
 * Rent roll critical validations — structural integrity checks that produce a
 * 0–100 confidence score for a parsed roll. Ported from the DealCompass
 * importer; weights sum to 1.0. Checks that can't be evaluated because property
 * metadata is missing pass by default (not-applicable) rather than fail.
 */
import type { ParsedUnit } from "@/lib/rent-roll-mapping";

export type RentRollStats = {
  unit_count: number;
  parsed_unit_rows: number;
  from_property_summary: boolean;
};

export type RentRollParsed = { units: ParsedUnit[]; stats: RentRollStats };
export type PropertyMeta = { unitCount: number | null };

type Check = {
  id: string;
  name: string;
  weight: number;
  rule: (p: RentRollParsed, m: PropertyMeta) => boolean;
  errorMessage: (p: RentRollParsed, m: PropertyMeta) => string;
};

const fmt = (n: number) => Math.round(n).toLocaleString();

/** The summary section's stated unit count, when the parse found one. */
function summaryUnitCount(p: RentRollParsed): number | null {
  if (!p.stats.from_property_summary) return null;
  const n = p.stats.unit_count;
  return typeof n === "number" && n > 0 ? n : null;
}

const CHECKS: Check[] = [
  {
    id: "rr_unit_count_match",
    name: "Unit Count Match",
    weight: 0.25,
    rule: (p, m) => {
      if (m.unitCount == null) return true; // not applicable
      return p.units.length === m.unitCount;
    },
    errorMessage: (p, m) =>
      `Parsed ${fmt(p.units.length)} unit rows; property shows ${fmt(m.unitCount ?? 0)} units. ` +
      `Possible column-detection error, missing rows, or wrong file uploaded.`,
  },
  {
    id: "rr_summary_rows_consistent",
    name: "Summary vs. Parsed Rows",
    weight: 0.15,
    rule: (p) => {
      const stated = summaryUnitCount(p);
      if (stated == null) return true;
      return p.units.length === stated;
    },
    errorMessage: (p) =>
      `The sheet's summary reports ${fmt(summaryUnitCount(p) ?? 0)} units but ` +
      `${fmt(p.units.length)} unit rows were extracted — rows are likely missing or duplicated.`,
  },
  {
    id: "rr_required_fields_present",
    name: "Required Fields Present",
    weight: 0.2,
    rule: (p) =>
      p.units.every(
        (u) =>
          !!u.unit_number &&
          (!!u.floor_plan_code || u.beds != null) &&
          (u.square_feet ?? 0) > 0 &&
          (u.status === "vacant" || u.market_rent != null || u.in_place_rent != null) &&
          !!u.status,
      ),
    errorMessage: (p) => {
      const missing = p.units
        .map((u, i) => {
          const issues: string[] = [];
          if (!u.unit_number) issues.push("unit_number");
          if (!u.floor_plan_code && u.beds == null) issues.push("floor_plan/beds");
          if (!((u.square_feet ?? 0) > 0)) issues.push("square_feet");
          if (u.status !== "vacant" && u.market_rent == null && u.in_place_rent == null)
            issues.push("rent");
          if (!u.status) issues.push("status");
          return issues.length ? `${u.unit_number || `row ${i + 1}`}: ${issues.join(", ")}` : null;
        })
        .filter(Boolean) as string[];
      return (
        `Missing required fields in ${missing.length} unit(s): ${missing.slice(0, 5).join("; ")}` +
        (missing.length > 5 ? ` …and ${missing.length - 5} more` : "")
      );
    },
  },
  {
    id: "rr_no_negative_numerics",
    name: "No Negative Values",
    weight: 0.15,
    rule: (p) =>
      p.units.every(
        (u) => (u.market_rent ?? 0) >= 0 && (u.in_place_rent ?? 0) >= 0 && (u.square_feet ?? 0) > 0,
      ),
    errorMessage: (p) => {
      const issues = p.units
        .map((u, i) => {
          const parts: string[] = [];
          if ((u.market_rent ?? 0) < 0) parts.push(`market_rent ${u.market_rent}`);
          if ((u.in_place_rent ?? 0) < 0) parts.push(`in_place_rent ${u.in_place_rent}`);
          if (!((u.square_feet ?? 0) > 0)) parts.push(`sqft ${u.square_feet}`);
          return parts.length ? `${u.unit_number || `row ${i + 1}`}: ${parts.join(", ")}` : null;
        })
        .filter(Boolean) as string[];
      return `Negative or zero values in ${issues.length} unit(s): ${issues.slice(0, 5).join("; ")}`;
    },
  },
  {
    id: "rr_no_duplicate_unit_ids",
    name: "No Duplicate Unit IDs",
    weight: 0.15,
    rule: (p) => {
      const ids = p.units.map((u) => u.unit_number);
      return ids.length === new Set(ids).size;
    },
    errorMessage: (p) => {
      const ids = p.units.map((u) => u.unit_number);
      const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
      return `Duplicate unit numbers: ${dupes.join(", ")}. Possible row duplication during export.`;
    },
  },
  {
    id: "rr_unit_mix_has_variety",
    name: "Unit Mix Variety",
    weight: 0.1,
    rule: (p) => {
      if (p.units.length <= 1) return true;
      const plans = new Set(p.units.map((u) => u.floor_plan_code ?? `${u.beds ?? "?"}br`));
      return plans.size > 1;
    },
    errorMessage: (p) => {
      const plans = [...new Set(p.units.map((u) => u.floor_plan_code ?? `${u.beds ?? "?"}br`))];
      return (
        `Only one floor plan detected: "${plans[0]}". If this property has multiple plans, ` +
        `the floor-plan column may not have been parsed correctly.`
      );
    },
  },
];

export type ValidationResult = {
  score: number; // 0–100
  failures: { id: string; name: string; message: string }[];
};

export function validateRentRoll(parsed: RentRollParsed, meta: PropertyMeta): ValidationResult {
  let earned = 0;
  const failures: ValidationResult["failures"] = [];
  for (const check of CHECKS) {
    if (check.rule(parsed, meta)) {
      earned += check.weight;
    } else {
      failures.push({ id: check.id, name: check.name, message: check.errorMessage(parsed, meta) });
    }
  }
  return { score: Math.round(earned * 100), failures };
}
