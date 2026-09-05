import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Button } from "@/components/ui/button";
import { PropertyHeader } from "@/components/property-header";
import { PropertyNav } from "@/components/property-nav";
import { ProjectBoard, type BoardProject } from "@/components/project-board";
import { num } from "@/lib/format";
import { readScheduleHealth } from "@/lib/target-slip";
import { getScheduleProjects } from "@/lib/schedule-data";
import { evaluateGates, nextStep, type NextStep } from "@/lib/phase-gates";
import { readGateStates, type FullGateState } from "@/lib/precon-gate-state";
import { nextPhase, type ProjectPhaseKey } from "@/lib/stages";
import { loadActiveProfile } from "@/lib/auth";
import { canWriteProperty } from "@/lib/auth-rules";
import { readManagerRoster } from "@/lib/manager-roster";
import { managerName } from "@/lib/project-managers";

/**
 * The one step to offer on a row.
 *
 * Runs the same evaluateGates the project page's gate list runs, then asks
 * nextStep which of its checks is blocking. Nothing about "what is next" is
 * decided here — this only picks the phase transition to evaluate.
 */
function stepFor(phase: string, state: FullGateState | undefined): NextStep {
  const upcoming = nextPhase(phase);
  // Last phase, or a project that vanished between the two reads. Either way
  // there is nothing honest to offer, and an advance we could not check the
  // gates for is not it.
  if (!upcoming || !state) return { kind: "none" };
  return nextStep(evaluateGates(phase as ProjectPhaseKey, upcoming.key, state), upcoming);
}

export const dynamic = "force-dynamic";

export default async function PropertyBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.slug, slug),
  });
  if (!property) notFound();
  const propertyId = property.id;

  const [rows, [archivedCount], ganttProjects, auth, roster] = await Promise.all([
    // Board rows — projects joined to their UW line item + category (division).
    db()
      .select({
        id: schema.projects.id,
        name: schema.projects.name,
        phase: schema.projects.phase,
        budgetAmount: schema.projects.budgetAmount,
        startDate: schema.projects.startDate,
        completeDate: schema.projects.completeDate,
        costCodeName: schema.costCodes.name,
        categoryName: schema.costCategories.name,
        division: schema.costCategories.division,
        // Both kinds live in one list now. A turn and a common-area job differ
        // in how they are scoped and priced, not in what they are afterwards —
        // both carry scope, bids, contracts, phases, GL and a schedule, and all
        // of that was already kind-agnostic.
        kind: schema.projects.kind,
        managerId: schema.projects.managerId,
        // Joined rather than resolved from the roster on the client: a manager
        // who has since been archived still holds the projects they were
        // running, and the column has to keep naming them.
        managerFullName: schema.profiles.fullName,
        managerEmail: schema.profiles.email,
        unitNumber: schema.units.unitNumber,
        renovationType: schema.budgetGroups.name,
      })
      .from(schema.projects)
      .leftJoin(schema.costCodes, eq(schema.projects.costCodeId, schema.costCodes.id))
      .leftJoin(schema.costCategories, eq(schema.costCodes.categoryId, schema.costCategories.id))
      .leftJoin(schema.units, eq(schema.projects.unitId, schema.units.id))
      .leftJoin(schema.profiles, eq(schema.projects.managerId, schema.profiles.id))
      .leftJoin(schema.budgetGroups, eq(schema.projects.budgetGroupId, schema.budgetGroups.id))
      .where(
        and(
          eq(schema.projects.propertyId, propertyId),
          isNull(schema.projects.archivedAt),
        ),
      )
      .orderBy(asc(schema.projects.createdAt)),
    db()
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.propertyId, propertyId),
          sql`${schema.projects.archivedAt} is not null`,
        ),
      ),
    // The Gantt on this tab is the Schedule tab's, so it reads the same rows:
    // phase targets, actuals and slip, rather than the board's budget shape.
    getScheduleProjects({ propertyId }),
    // Guarded. This call exists only to decide whether to show a picker, and it
    // reaches Supabase auth over the network — unguarded, a pooled-connection
    // timeout there took the whole board down with it, budgets and schedule and
    // all. Failing closed costs a reader the picker and nothing else.
    loadActiveProfile().catch((err) => {
      console.error("property board: auth lookup failed", err);
      return { ok: false as const, error: "auth unavailable", code: "no_session" as const };
    }),
    // Loaded for everyone so it can share this batch; passed to the client only
    // when the reader can actually assign.
    readManagerRoster().catch((err) => {
      console.error("property board: manager roster failed to load", err);
      return [];
    }),
  ]);
  // Only these two need `rows`, so they are the one stage that has to wait.
  // Everything else went in the batch above: five serial round trips to a remote
  // Postgres is most of what a board load costs, and it is what made an inline
  // manager assignment look like it had done nothing for several seconds.
  const [health, gateStates] = await Promise.all([
    // How far each project's finish has moved from what was first planned, which
    // is the one schedule number that survives targets being pushed forward.
    readScheduleHealth(rows.map((r) => r.id)),
    // Every row's gate state in nine queries, not nine per row. See
    // readGateStates — the per-project reader would have made this page O(n)
    // round trips, which a property mid-turn would never finish.
    readGateStates(rows.map((r) => r.id)),
  ]);

  // Assigning is a write, so a site or viewer reader gets the names and no
  // picker — and the roster is not passed to a client that could not use it.
  const canAssign = auth.ok && canWriteProperty(auth.profile.role);
  const assignableRoster = canAssign ? roster : [];

  const projects: BoardProject[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    phase: r.phase,
    budget: num(r.budgetAmount),
    // The same posted-GL total the "GL actuals posted" gate reads. It used to be
    // its own query filtered by property rather than project, so a transaction
    // whose project and property disagreed could show a Variance here while the
    // gate still said no GL had been posted.
    jtd: gateStates.get(r.id)?.postedGlTotal ?? 0,
    startDate: r.startDate,
    completeDate: r.completeDate,
    division: r.division ?? null,
    categoryLabel: r.categoryName ?? "Uncategorized",
    lineItem: r.costCodeName ?? "—",
    kind: r.kind,
    managerId: r.managerId ?? null,
    // profiles.email is NOT NULL, so a joined row always has one — its presence
    // is what says somebody is assigned at all.
    managerName: r.managerEmail ? managerName(r.managerFullName, r.managerEmail) : null,
    nextStep: stepFor(r.phase, gateStates.get(r.id)),
    unitLabel: r.unitNumber ? `Unit ${r.unitNumber}` : null,
    // The renovation type a turn was priced from. Carried here so the merged
    // list keeps the one thing the separate Unit Upgrades table showed that
    // this one did not.
    renovationType: r.renovationType ?? null,
    health: health.get(r.id) ?? {
      slipDays: 0,
      baselineDays: 0,
      forecastFinish: null,
      status: "unknown" as const,
    },
  }));

  return (
    <div className="space-y-6">
      <PropertyHeader
        property={property}
        action={
          <div className="flex items-center gap-3">
            {archivedCount.count > 0 && (
              <Link
                href={`/properties/${slug}/projects/archived`}
                className="text-sm text-link hover:underline"
              >
                Archived ({archivedCount.count})
              </Link>
            )}
            <Button
              render={<Link href={`/properties/${slug}/projects/new`} />}
              nativeButton={false}
            >
              New project
            </Button>
          </div>
        }
      />

      <PropertyNav slug={property.slug} />

      <ProjectBoard
        projects={projects}
        ganttProjects={ganttProjects}
        propertySlug={property.slug}
        roster={assignableRoster}
        canAssign={canAssign}
        initialView={typeof sp.view === "string" ? sp.view : undefined}
        initialGroup={typeof sp.group === "string" ? sp.group : undefined}
        initialSort={typeof sp.sort === "string" ? sp.sort : undefined}
        initialDir={typeof sp.dir === "string" ? sp.dir : undefined}
        initialQuery={typeof sp.q === "string" ? sp.q : undefined}
      />
    </div>
  );
}
