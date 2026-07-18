import { cn } from "@/lib/utils";

export type KpiDeltaVariant = "positive" | "pending" | "muted";

export type KpiItem = {
  label: string;
  value: string;
  delta?: string;
  deltaVariant?: KpiDeltaVariant;
};

const deltaClass: Record<KpiDeltaVariant, string> = {
  positive: "text-positive",
  pending: "text-pending",
  muted: "text-text-muted",
};

export function KpiStrip({
  items,
  className,
}: {
  items: KpiItem[];
  className?: string;
}) {
  return (
    <div
      className={cn("grid gap-3.5", className)}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))` }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-card border border-border bg-card px-5 py-[18px]"
        >
          <div className="text-[11px] font-semibold tracking-[0.05em] text-text-faint uppercase">
            {item.label}
          </div>
          <div className="mt-2 text-[22px] font-bold tracking-tight text-text tabular-nums">
            {item.value}
          </div>
          {item.delta ? (
            <div
              className={cn(
                "mt-1 text-xs font-semibold",
                deltaClass[item.deltaVariant ?? "muted"]
              )}
            >
              {item.delta}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
