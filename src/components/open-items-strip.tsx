import { AlertTriangleIcon, CalendarIcon, ClockIcon } from "lucide-react";

export type OpenItemsSummary = {
  overdue: number;
  dueSoon: number;
  later: number;
};

export function OpenItemsStrip({
  items,
}: {
  items: OpenItemsSummary;
}) {
  const total = items.overdue + items.dueSoon + items.later;
  if (total === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 text-xs font-medium">
      {items.overdue > 0 && (
        <span className="flex items-center gap-1.5 rounded-md border border-alert/20 bg-alert/5 px-2.5 py-1.5 text-alert">
          <AlertTriangleIcon className="h-3.5 w-3.5" />
          {items.overdue} overdue
        </span>
      )}
      {items.dueSoon > 0 && (
        <span className="flex items-center gap-1.5 rounded-md border border-pending/20 bg-pending/5 px-2.5 py-1.5 text-pending">
          <ClockIcon className="h-3.5 w-3.5" />
          {items.dueSoon} due within 7 days
        </span>
      )}
      {items.later > 0 && (
        <span className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-muted-foreground">
          <CalendarIcon className="h-3.5 w-3.5" />
          {items.later} upcoming
        </span>
      )}
    </div>
  );
}
