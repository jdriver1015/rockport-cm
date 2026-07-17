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
      className={cn(
        "grid divide-x divide-border overflow-hidden rounded-card border border-border bg-card",
        className
      )}
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <div key={item.label} className="px-[22px] py-[18px]">
          <div className="text-[11px] font-semibold tracking-[0.05em] text-text-faint uppercase">
            {item.label}
          </div>
          <div className="mt-1.5 text-[23px] font-bold tracking-tight text-text tabular-nums">
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
