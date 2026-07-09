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

export function num(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return n == null || Number.isNaN(n) ? 0 : n;
}
