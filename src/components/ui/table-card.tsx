import { cn } from "@/lib/utils";

export function TableCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-card border border-border bg-card shadow-[0_1px_2px_rgba(22,35,58,0.05)]",
        className
      )}
    >
      {children}
    </div>
  );
}
