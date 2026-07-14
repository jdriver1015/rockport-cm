import type { ReactNode } from "react";
import { fmtDate } from "@/lib/format";

export type PropertyHeaderData = {
  name: string;
  entity: string | null;
  city: string | null;
  state: string | null;
  unitCount: number | null;
  glUpdatedThru: string | null;
};

export function PropertyHeader({
  property,
  action,
}: {
  property: PropertyHeaderData;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-navy">{property.name}</h1>
        <p className="text-sm text-muted-foreground">
          {[property.entity, [property.city, property.state].filter(Boolean).join(", ")]
            .filter(Boolean)
            .join(" · ") || "—"}
          {property.unitCount ? ` · ${property.unitCount} units` : ""}
          {property.glUpdatedThru ? ` · GL thru ${fmtDate(property.glUpdatedThru)}` : ""}
        </p>
      </div>
      {action}
    </div>
  );
}
