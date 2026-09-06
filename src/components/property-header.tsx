import type { ReactNode } from "react";
import Link from "next/link";
import { fmtDate } from "@/lib/format";
import { EditPropertyDialog } from "@/components/edit-property-dialog";
import {
  ArchivePropertyDialog,
  RestorePropertyButton,
} from "@/components/archive-property-dialog";

export type PropertyHeaderData = {
  id: number;
  slug: string;
  name: string;
  entity: string | null;
  city: string | null;
  state: string | null;
  unitCount: number | null;
  pmSystem: string | null;
  glUpdatedThru: string | null;
  /** Set when the property is archived — its pages still resolve by slug. */
  archivedAt?: Date | null;
};

export function PropertyHeader({
  property,
  action,
}: {
  property: PropertyHeaderData;
  action?: ReactNode;
}) {
  const archived = property.archivedAt != null;
  return (
    <div>
      <p className="text-sm">
        <Link href="/" className="text-link hover:underline">
          ← Portfolio
        </Link>
      </p>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-navy">
            {property.name}
            {archived && (
              <span className="ml-2 rounded-control bg-track px-2 py-0.5 align-middle text-[11px] font-semibold tracking-[0.09em] text-ink-400 uppercase">
                Archived
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {[property.entity, [property.city, property.state].filter(Boolean).join(", ")]
              .filter(Boolean)
              .join(" · ") || "—"}
            {property.unitCount ? ` · ${property.unitCount} units` : ""}
            {property.glUpdatedThru ? ` · GL thru ${fmtDate(property.glUpdatedThru)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {archived ? (
            <RestorePropertyButton propertyId={property.id} />
          ) : (
            <>
              {action}
              <EditPropertyDialog property={property} />
              <ArchivePropertyDialog propertyId={property.id} propertyName={property.name} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
