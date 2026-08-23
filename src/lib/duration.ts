/**
 * Whole days between a past timestamp and now.
 *
 * Lives outside the component because reading the clock during render is
 * impure — the React compiler refuses it, and rightly: two renders of the same
 * props would disagree. Calling it from a server component is fine, the page is
 * dynamic and the answer is only ever "as of this request".
 *
 * Accepts a date-only string (a `date` column) as local midnight, matching how
 * variance is counted elsewhere.
 */
export function daysSince(value: Date | string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const t = typeof value === "string" ? new Date(`${value}T00:00:00`).getTime() : value.getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}
