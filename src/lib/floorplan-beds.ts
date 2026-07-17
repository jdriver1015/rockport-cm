// Infer beds/baths from a floor-plan code string when the rent roll doesn't
// have explicit beds/baths columns. Two conventions handled:
//
//   "NxM" / "N×M" — e.g. "2x1" → beds=2, baths=1
//
//   Letter prefix — property managers label plans A, B, C… where A = 1 BR,
//   B = 2 BR, C = 3 BR, etc. The letter can appear at the start or after a
//   separator (dash, underscore, space), optionally followed by a digit suffix
//   (e.g. "A1", "B2", "rw-b1"). Only A–F are treated as bed counts (1–6);
//   letters beyond F are too ambiguous to infer.
//
// Pure + client-safe (no server-only imports) so both the rent-roll parser
// and any Unit Mix aggregation can share one definition.
export function inferBedsFromPlan(code: string | null): {
  beds: number | null;
  baths: number | null;
} {
  if (!code) return { beds: null, baths: null };
  const s = code.trim();

  // "2x1", "2X1", "2 x 1" → beds=2, baths=1
  const nxm = s.match(/\b(\d+)\s*[xX×]\s*(\d+)\b/);
  if (nxm) {
    return { beds: Number(nxm[1]), baths: Number(nxm[2]) };
  }

  // Letter after start or separator, optionally followed by a digit or end.
  // "A" → 1, "B2" → 2, "rw-b1" → 2, "plan_c" → 3
  // Guard: the character after the letter must be a digit or end-of-string
  // so that words like "Classic" (C followed by 'l') don't match.
  const letterMatch = s.match(/(?:^|[-_\s])([a-fA-F])(?:\d|$)/);
  if (letterMatch) {
    const beds = letterMatch[1].toLowerCase().charCodeAt(0) - "a".charCodeAt(0) + 1;
    return { beds, baths: null };
  }

  return { beds: null, baths: null };
}

/** Extract bedroom count from a floorplan code for display grouping (Unit Mix
 *  buckets). Same letter/NxM convention as inferBedsFromPlan above, but always
 *  resolves to a number (Studio/unknown → 0) rather than null, and adds a
 *  bare-digit-sequence fallback ("3br" → 3) — this feeds a bucket label, so an
 *  unknown code should land in Studio rather than drop. */
export function getBRCount(code: string): number {
  const s = code.trim();
  const nxm = s.match(/(\d+)\s*[xX×]\s*\d+/);
  if (nxm) return parseInt(nxm[1]);
  // Letter convention: an A–F letter not immediately surrounded by other
  // letters (avoids matching the "b" in "bed", "br", "plan", etc.).
  const letter = s.match(/(?<![a-zA-Z])([a-fA-F])(?![a-zA-Z])/);
  if (letter) return letter[1].toLowerCase().charCodeAt(0) - "a".charCodeAt(0) + 1;
  const num = s.match(/\d+/);
  return num ? parseInt(num[0]) : 0;
}

export const BR_LABELS: Record<number, string> = {
  0: "Studio",
  1: "1 Bedroom",
  2: "2 Bedroom",
  3: "3 Bedroom",
  4: "4 Bedroom",
};
