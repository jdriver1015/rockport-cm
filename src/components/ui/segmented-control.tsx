import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = {
  key: T;
  label: string;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex gap-0.5 rounded-control bg-track p-[3px]",
        className
      )}
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded-control-active px-3 py-1 text-[13px] font-semibold transition-colors",
            value === o.key
              ? "bg-navy text-white"
              : "text-text-muted hover:text-text"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
