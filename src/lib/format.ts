const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

/** Whole-dollar display, workbook style: $1,234 / ($1,234) / — */
export function money(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (n == null || Number.isNaN(n) || n === 0) return "—";
  return n < 0 ? `(${usd0.format(Math.abs(n))})` : usd0.format(n);
}

/**
 * Currency with $0 shown as $0, not elided to an em dash.
 *
 * money() treats zero as absent, which is right for an optional field nobody
 * has set. It is wrong for a computed remainder: a budget category spent down
 * to the last dollar is a real, common answer — "Roof: $0 left" — and money()
 * rendered it as "Roof: — left", which reads as unknown rather than exhausted.
 */
export function moneyOrZero(value: number): string {
  return value < 0 ? `(${usd0.format(Math.abs(value))})` : usd0.format(value);
}

/** Cent-precise display for transaction/budget detail rows */
export function moneyExact(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (n == null || Number.isNaN(n)) return "—";
  return n < 0 ? `(${usd2.format(Math.abs(n))})` : usd2.format(n);
}

export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(`${value}T00:00:00`) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Month and day only — for prose that sits beside a full date, where repeating
 * the year adds length without adding anything.
 */
export function fmtDateShort(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function num(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return n == null || Number.isNaN(n) ? 0 : n;
}

/**
 * Two-letter monogram for a vendor avatar. Words that do not start with a
 * letter are skipped, so "3M Roofing" reads MR rather than 3R.
 */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
