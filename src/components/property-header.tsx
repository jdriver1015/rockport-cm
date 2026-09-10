import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
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

/** Lowercased, punctuation-free, for comparing a name against an entity. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function PropertyHeader({
  property,
  action,
}: {
  property: PropertyHeaderData;
  action?: ReactNode;
}) {
  const archived = property.archivedAt != null;
  // The owning entity is usually the property name with a suffix — "Willow
  // Creek Apartments" owned by "Willow Creek Apartments, LLC" — and printing
  // both puts the name twice in two lines. Dropped when it adds nothing but
  // the suffix; kept when the entity is genuinely a different name.
  const entity =
    property.entity && !normalize(property.entity).startsWith(normalize(property.name))
      ? property.entity
      : null;
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
              <Badge
                variant="secondary"
                className="ml-2 align-middle text-[11px] tracking-[0.09em] uppercase"
              >
                Archived
              </Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {[entity, [property.city, property.state].filter(Boolean).join(", ")]
              .filter(Boolean)
              .join(" · ") || "—"}
            {property.unitCount ? ` · ${property.unitCount} units` : ""}
            {property.glUpdatedThru ? ` · GL thru ${fmtDate(property.glUpdatedThru)}` : ""}
          </p>
        </div>
        {/* Quieter on a phone: on this screen the job is to find a project and
            tap into it, not to administer the property. These stay reachable
            but stop competing with the list. */}
        <div className="flex items-center gap-1 sm:gap-2 [&_button]:h-8 [&_button]:text-[13px] sm:[&_button]:h-auto sm:[&_button]:text-sm">
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
