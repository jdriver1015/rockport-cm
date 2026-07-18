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
        "overflow-hidden rounded-card border border-border bg-card shadow-sm",
        className
      )}
    >
      {children}
    </div>
  );
}
