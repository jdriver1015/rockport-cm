import { cn } from "@/lib/utils";
import { money } from "@/lib/format";

/**
 * Right-aligned, weight-600 currency display for table cells — the spec's
 * "currency right-aligned weight 600, positive values in --positive, em-dash
 * for empty" rule, applied once instead of per table.
 */
export function AmountCell({
  value,
  positive = false,
  className,
}: {
  value: number | string | null | undefined;
  positive?: boolean;
  className?: string;
}) {
  const formatted = money(value);
  const isEmpty = formatted === "—";
  return (
    <span
      className={cn(
        "block text-right font-semibold tabular-nums",
        isEmpty ? "text-text-faint" : positive ? "text-positive" : "text-text",
        className
      )}
    >
      {formatted}
    </span>
  );
}
