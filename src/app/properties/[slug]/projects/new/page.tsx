import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import { AlertTriangleIcon, Building2Icon, DoorOpenIcon, type LucideIcon } from "lucide-react";
import { db, schema } from "@/db";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl text-navy">
          New project — {property.name}
        </h1>
        <p className="mt-1.5 text-[13.5px] text-muted-foreground">
          What kind of work is it? This decides how the scope gets priced, and it
          cannot be changed afterwards.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {tiers > 0 ? (
          <ProjectKindCard
            href={`/properties/${slug}/interiors/new`}
            icon={DoorOpenIcon}
            title="Unit interior"
            cta="Start a unit turn"
          >
            <p className="text-[13px] leading-relaxed text-ink-600">
              One apartment being turned. Priced from a renovation type, so the scope arrives
              already costed, and it spends across every interior category rather than one.
            </p>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Pick this for anything measured per unit — a make-ready, a full renovation, a
              down unit.
            </p>
          </ProjectKindCard>
        ) : (
          <ProjectKindCard icon={DoorOpenIcon} title="Unit interior" disabled>
            <p className="text-[13px] leading-relaxed text-ink-500">
              One apartment being turned. Priced from a renovation type, so the scope arrives
              already costed, and it spends across every interior category rather than one.
            </p>
            <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-alert">
              <AlertTriangleIcon className="mt-px size-3.5 shrink-0" />
              This property has no renovation types yet, and a turn is priced from one. Add one
              under Budget first.
            </p>
          </ProjectKindCard>
        )}

        <ProjectKindCard
          href={`/properties/${slug}/projects/new/common-area`}
          icon={Building2Icon}
          title="Common area"
          cta="Start a common-area project"
        >
          <p className="text-[13px] leading-relaxed text-ink-600">
            Anything that is not one apartment — roofs, exterior paint, amenities, signage.
            The scope is written by hand and each line is coded to the budget category it
            spends against.
          </p>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Pick this for work measured for the property as a whole, however many units it
            eventually touches.
          </p>
        </ProjectKindCard>
      </div>

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

/**
 * One path through the fork, as a single click target rather than a card
 * that merely contains one. The icon and title carry which path this is at
 * a glance; the paragraphs (passed as children) carry the why.
 */
function ProjectKindCard({
  icon: Icon,
  title,
  children,
  ...props
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
} & (
  | { href: string; cta: string; disabled?: undefined }
  | { href?: undefined; cta?: undefined; disabled: true }
)) {
  const badge = (
    <div
      className={cn(
        "flex size-11 items-center justify-center rounded-full transition-colors",
        props.disabled
          ? "bg-muted text-ink-300"
          : "bg-navy/8 text-navy group-hover:bg-navy group-hover:text-on-navy",
      )}
    >
      <Icon className="size-5" />
    </div>
  );

  if (props.disabled) {
    return (
      <div className="flex flex-col gap-4 rounded-card border border-dashed border-border bg-muted/20 p-5">
        {badge}
        <div className="space-y-1.5">
          <h2 className="text-[16px] font-semibold text-ink-400">{title}</h2>
          {children}
        </div>
      </div>
    );
  }

  return (
    <Link
      href={props.href}
      className="group flex flex-col gap-4 rounded-card border border-border bg-card p-5 shadow-[0_1px_2px_rgba(22,35,58,0.05)] transition-all hover:-translate-y-0.5 hover:border-navy/25 hover:shadow-md"
    >
      {badge}
      <div className="space-y-1.5">
        <h2 className="text-[16px] font-semibold text-navy">{title}</h2>
        {children}
      </div>
      <span className={cn(buttonVariants({ size: "sm" }), "mt-1 w-fit")}>{props.cta}</span>
    </Link>
  );
}
