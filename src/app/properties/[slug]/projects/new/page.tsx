import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Which kind of project is this?
//
// Now that both kinds live in one Projects list, "New project" has to ask —
// and the two are not variations on a form, they are different jobs. A unit
// turn is priced from a renovation type against a fleet of units and carries
// rent economics; a common-area project is scoped by hand against the
// underwritten budget. Each has its own wizard, so this routes rather than
// branching inside one.
//
// The answer is nearly always obvious from the work itself, so this page's job
// is to be quick to get past, not to interrogate anybody.
// ---------------------------------------------------------------------------

export default async function ChooseProjectKindPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.slug, slug),
  });
  if (!property) notFound();

  // Whether a turn can even be started here. The interior wizard prices from a
  // renovation type, so with none defined it can only dead-end — better to say
  // so on the way in than after two steps.
  const [{ tiers }] = await db()
    .select({ tiers: sql<number>`count(*)::int` })
    .from(schema.budgetGroups)
    .where(
      and(
        eq(schema.budgetGroups.propertyId, property.id),
        isNull(schema.budgetGroups.archivedAt),
      ),
    );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="font-heading text-xl text-navy">
          New project — {property.name}
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          What kind of work is it? This decides how the scope gets priced, and it
          cannot be changed afterwards.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-1.5 pt-5">
          <h2 className="text-[15px] font-medium text-navy">Unit interior</h2>
          <p className="text-[13px] leading-relaxed text-ink-600">
            One apartment being turned. Priced from a renovation type, so the scope arrives
            already costed, and it spends across every interior category rather than one.
          </p>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Pick this for anything measured per unit — a make-ready, a full renovation, a
            down unit.
          </p>
          <div className="pt-2">
            {tiers > 0 ? (
              <Button
                render={<Link href={`/properties/${slug}/interiors/new`} />}
                nativeButton={false}
              >
                Start a unit turn
              </Button>
            ) : (
              <div className="space-y-1.5">
                <Button disabled>Start a unit turn</Button>
                <p className="text-[12px] text-alert">
                  This property has no renovation types yet, and a turn is priced from one.
                  Add one under Budget first.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1.5 pt-5">
          <h2 className="text-[15px] font-medium text-navy">Common area</h2>
          <p className="text-[13px] leading-relaxed text-ink-600">
            Anything that is not one apartment — roofs, exterior paint, amenities, signage.
            The scope is written by hand and each line is coded to the budget category it
            spends against.
          </p>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Pick this for work measured for the property as a whole, however many units it
            eventually touches.
          </p>
          <div className="pt-2">
            <Button
              render={<Link href={`/properties/${slug}/projects/new/common-area`} />}
              nativeButton={false}
            >
              Start a common-area project
            </Button>
          </div>
        </CardContent>
      </Card>

      <div>
        <Button
          render={<Link href={`/properties/${slug}`} />}
          variant="ghost"
          nativeButton={false}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
