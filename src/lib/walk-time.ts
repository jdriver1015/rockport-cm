/**
 * Walk times are quarter-hours.
 *
 * Site walks get scheduled the way meetings do — half nine, quarter to two —
 * and a free-text minute field invites 10:07, which is noise nobody meant. The
 * step below drives the picker; the rounding below is what actually enforces
 * it, because `step` only constrains the browser's spinner and a typed or
 * pasted value can still arrive at any minute.
 */

/** Seconds. `<input type="time" step={QUARTER_HOUR_STEP}>` snaps to :00/:15/:30/:45. */
export const QUARTER_HOUR_STEP = 900;

/**
 * Snap "HH:MM" (or "HH:MM:SS") to the nearest quarter hour, or null if it is
 * not a time at all. 23:53 rounds to 00:00 rather than 24:00 — an hour of 24
 * is not a valid `time` and Postgres would reject the row.
 */
export function roundToQuarterHour(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  const total = Math.round((hours * 60 + minutes) / 15) * 15;
  const wrapped = total % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
