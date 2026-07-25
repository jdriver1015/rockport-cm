import { cn } from "@/lib/utils";
import { money } from "@/lib/format";

/**
 * Right-aligned, weight-600 currency display for table cells — the spec's
 * "currency right-aligned weight 600, positive values in --positive, em-dash
 * for empty" rule, applied once instead of per table.
 *
 * Empty values render as an em-dash in ink-100 (line items). Emphasis rows
 * (section bands, group subtotals) pass `emptyClassName="text-ink-200"` so the
 * placeholder tracks the heavier row weight.
 */
export function AmountCell({
  value,
  positive = false,
  className,
  emptyClassName,
}: {
  value: number | string | null | undefined;
  positive?: boolean;
  className?: string;
  emptyClassName?: string;
}) {
  const formatted = money(value);
  const isEmpty = formatted === "—";
  return (
    <span
      className={cn(
        "block text-right font-semibold tabular-nums",
        positive ? "text-positive" : "text-ink-700",
        className,
        // Listed after `className` so an emphasis row's own text color can't
        // repaint the placeholder — the em-dash always stays a quiet gray.
        isEmpty && cn("text-ink-100", emptyClassName)
      )}
    >
      {formatted}
    </span>
  );
}
