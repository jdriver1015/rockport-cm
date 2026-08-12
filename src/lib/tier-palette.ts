/**
 * Shared color scheme for renovation tiers (budget groups) — used on both the
 * interior budget pivot and the Unit Upgrades list so a tier reads the same
 * color everywhere. Index is the tier's ordinal position among a property's
 * budget groups (ordered by sortOrder, name), not tied to the tier's name.
 */
export const TIER_PALETTE = [
  { text: "#1b3a6b", bg: "#dde6f5", border: "#c3d3ec", dot: "#4a74c4" },
  { text: "#7a4711", bg: "#f7e7cf", border: "#ecd4ae", dot: "#c9873a" },
] as const;

export function tierColor(index: number) {
  return TIER_PALETTE[Math.min(Math.max(index, 0), TIER_PALETTE.length - 1)];
}
