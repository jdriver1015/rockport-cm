import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { PrintButton } from "@/components/print-button";
import { computeInteriorBudgetFor } from "@/lib/interior-budget";
import { listSpecTables } from "@/lib/spec-tables-store";
import { listTradeScopeRows } from "@/lib/trade-scope-store";
import { SPEC_KIND_LABELS, SPEC_KINDS, isFilledRow } from "@/lib/spec-tables";
import { isWritten, mergeTradeScopes, writtenCount } from "@/lib/trade-scope";
import { PRICING_METHOD_LABELS, type PricingMethod } from "@/lib/pricing";
import { money, num } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * The GC-facing bid sheet: everything a contractor needs to price this
 * renovation type, on paper.
 *
 * Our own figures are OFF by default and only appear with ?ref=1. A bidder who
 * can see the budget prices against it rather than against the work, so showing
 * them has to be a deliberate choice for the cases where it helps (a negotiated
 * renewal, a known contractor) rather than the default for a competitive bid.
 */
export default async function BidSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; typeId: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const [{ slug, typeId: typeIdParam }, { ref }] = await Promise.all([params, searchParams]);
  const showReference = ref === "1";

  const groupId = Number(typeIdParam);
  if (!Number.isInteger(groupId)) notFound();

  const property = await db().query.properties.findFirst({
    where: eq(schema.properties.slug, slug),
  });
  if (!property) notFound();
  const propertyId = property.id;

  const group = await db().query.budgetGroups.findFirst({
    where: eq(schema.budgetGroups.id, groupId),
  });
  if (!group || group.propertyId !== propertyId) notFound();

  const owner = { level: "group" as const, budgetGroupId: groupId, propertyId };

  const [lines, interiorCodes, budget, scopeRows, specTables] = await Promise.all([
    db()
      .select()
      .from(schema.budgetGroupLines)
      .where(eq(schema.budgetGroupLines.budgetGroupId, groupId))
      .orderBy(asc(schema.budgetGroupLines.sortOrder), asc(schema.budgetGroupLines.id)),
    db()
      .select({ id: schema.costCodes.id, code: schema.costCodes.code, name: schema.costCodes.name })
      .from(schema.costCodes)
      .where(
        and(
          eq(schema.costCodes.chartId, property.chartOfAccountsId),
          eq(schema.costCodes.isInterior, true),
        ),
      ),
    computeInteriorBudgetFor(propertyId),
    listTradeScopeRows(owner),
    listSpecTables(owner),
  ]);

  const codeById = new Map(interiorCodes.map((c) => [c.id, c]));
  const scopeEntries = mergeTradeScopes(scopeRows);
  const scopeSummary = writtenCount(scopeEntries);

  // Volume, floorplan mix and average size come from the interior plan. A bidder
  // needs these to price; they say nothing about what we expect to pay.
  const columns = budget.columns.filter((c) => c.tierId === groupId && c.plannedUnits > 0);
  const groupById = new Map(budget.unitGroups.map((g) => [g.id, g]));
  const planRows = columns
    .map((c) => {
      const g = groupById.get(c.unitGroupId);
      return {
        name: g?.name ?? `Group ${c.unitGroupId}`,
        avgSqft: g?.avgSqft ?? null,
        units: c.plannedUnits,
      };
    })
    .sort((a, b) => b.units - a.units);
  const unitsInScope = planRows.reduce((n, r) => n + r.units, 0);
  const sqftWeighted = planRows.reduce((n, r) => n + (r.avgSqft ?? 0) * r.units, 0);
  const avgSqft = unitsInScope > 0 && sqftWeighted > 0 ? Math.round(sqftWeighted / unitsInScope) : null;

  const specsByKind = new Map(SPEC_KINDS.map((k) => [k, specTables.filter((t) => t.kind === k)]));

  return (
    <div className="mx-auto max-w-[8.5in] bg-white text-ink-700 print:max-w-none">
      {/* Screen-only controls and readiness warning. */}
      <div className="mb-6 space-y-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/properties/${slug}/interiors/types/${groupId}`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to {group.name}
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href={`/properties/${slug}/interiors/types/${groupId}/bid-sheet${showReference ? "" : "?ref=1"}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {showReference ? "Hide our reference prices" : "Show our reference prices"}
            </Link>
            <PrintButton />
          </div>
        </div>

        {scopeSummary.written < scopeSummary.total && (
          <div className="rounded-card border border-alert/30 bg-alert-bg px-3 py-2 text-[13px] text-alert">
            {scopeSummary.total - scopeSummary.written} of {scopeSummary.total} trades have no written
            scope. They are listed below as not scoped so a bidder can see the gap, but this sheet
            is not ready to issue.
          </div>
        )}
        {showReference && (
          <div className="rounded-card border border-border bg-muted/40 px-3 py-2 text-[13px] text-ink-500">
            Our reference prices are included on this copy. A bidder who can see them prices against
            the budget rather than the work — leave them off for a competitive bid.
          </div>
        )}
      </div>

      {/* Letterhead */}
      <header className="border-b-2 border-navy pb-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-300">
              {property.entity ?? "Rockport"} · Construction Manager
            </div>
            <h1 className="mt-1 font-serif text-2xl font-semibold text-navy">
              {property.name} — Unit Interior Renovation Scope
            </h1>
            <p className="text-[13px] text-ink-500">
              {group.name} renovation type · Issued for bid
            </p>
          </div>
          <div className="text-right text-[11px] text-ink-400">
            {[property.city, property.state].filter(Boolean).join(", ")}
          </div>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact label="Units in scope" value={unitsInScope > 0 ? unitsInScope.toLocaleString() : "—"} />
          <Fact
            label="Floorplans"
            value={planRows.length > 0 ? planRows.map((r) => r.name).join(" · ") : "—"}
          />
          <Fact label="Avg unit SF" value={avgSqft != null ? avgSqft.toLocaleString() : "—"} />
          <Fact label="Trades in scope" value={String(scopeSummary.total)} />
        </dl>
      </header>

      {planRows.length > 0 && (
        <Section number={1} title="Unit mix">
          <p className="mb-2 text-[12px] leading-relaxed text-ink-500">
            Quantities are the current plan and may move. Price per unit unless a line says
            otherwise.
          </p>
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                <Th>Floorplan</Th>
                <Th align="right">Avg SF</Th>
                <Th align="right">Units</Th>
              </tr>
            </thead>
            <tbody>
              {planRows.map((r) => (
                <tr key={r.name} className="border-b border-hairline">
                  <Td>{r.name}</Td>
                  <Td align="right">{r.avgSqft != null ? r.avgSqft.toLocaleString() : "—"}</Td>
                  <Td align="right">{r.units.toLocaleString()}</Td>
                </tr>
              ))}
              <tr className="border-b-2 border-navy font-semibold">
                <Td>Total</Td>
                <Td align="right">{avgSqft != null ? avgSqft.toLocaleString() : "—"}</Td>
                <Td align="right">{unitsInScope.toLocaleString()}</Td>
              </tr>
            </tbody>
          </table>
        </Section>
      )}

      <Section number={planRows.length > 0 ? 2 : 1} title="Pricing schedule">
        <p className="mb-2 text-[12px] leading-relaxed text-ink-500">
          Enter a unit price for each line.
          {showReference
            ? " Our figures are shown for reference only and are neither a floor nor a ceiling."
            : ""}
        </p>
        {lines.length === 0 ? (
          <p className="text-[12.5px] text-ink-300">
            No priced lines on this renovation type yet.
          </p>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                <Th>Scope item</Th>
                <Th>Basis</Th>
                {showReference && <Th align="right">Ref.</Th>}
                <Th align="right">Your unit price</Th>
                <Th align="right">Extended</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((ln) => {
                const code = codeById.get(ln.costCodeId);
                return (
                  <tr key={ln.id} className="border-b border-hairline">
                    <Td>{ln.description ?? code?.name ?? `Code #${ln.costCodeId}`}</Td>
                    <Td>{PRICING_METHOD_LABELS[ln.pricingMethod as PricingMethod]}</Td>
                    {showReference && <Td align="right">{money(num(ln.unitPrice))}</Td>}
                    {/* Ruled blanks: this sheet is filled in by hand or in a PDF reader. */}
                    <Td align="right" className="w-24 border-b border-ink-100">
                      &nbsp;
                    </Td>
                    <Td align="right" className="w-24 border-b border-ink-100">
                      &nbsp;
                    </Td>
                  </tr>
                );
              })}
              <tr className="font-semibold">
                <Td>Total per unit</Td>
                <Td />
                {showReference && <Td />}
                <Td align="right" className="border-b-2 border-navy">
                  &nbsp;
                </Td>
                <Td align="right" className="border-b-2 border-navy">
                  &nbsp;
                </Td>
              </tr>
            </tbody>
          </table>
        )}
      </Section>

      <Section number={planRows.length > 0 ? 3 : 2} title="Scope of work">
        <div className="space-y-3">
          {scopeEntries.map((entry) => (
            <div key={entry.heading} className="break-inside-avoid">
              <h3 className="text-[13px] font-semibold text-navy">{entry.heading}</h3>
              {isWritten(entry) ? (
                <p className="mt-0.5 whitespace-pre-line text-[12.5px] leading-relaxed text-ink-700">
                  {entry.body}
                </p>
              ) : (
                <p className="mt-0.5 text-[12.5px] italic text-alert">
                  Not scoped — to be issued by addendum before bids are due.
                </p>
              )}
            </div>
          ))}
        </div>
      </Section>

      {SPEC_KINDS.map((kind, i) => {
        const tables = (specsByKind.get(kind) ?? []).filter((t) =>
          t.grid.rows.some(isFilledRow),
        );
        if (tables.length === 0) return null;
        return (
          <Section
            key={kind}
            number={(planRows.length > 0 ? 4 : 3) + i}
            title={SPEC_KIND_LABELS[kind]}
          >
            <div className="space-y-4">
              {tables.map((t) => (
                <div key={t.id} className="break-inside-avoid">
                  <h3 className="mb-1 text-[13px] font-semibold text-navy">{t.title}</h3>
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr>
                        {t.grid.cols.map((c, ci) => (
                          <Th key={ci}>{c}</Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {t.grid.rows.filter(isFilledRow).map((row, ri) => (
                        <tr key={ri} className="border-b border-hairline">
                          {row.map((cell, ci) => (
                            <Td key={ci}>{cell || "—"}</Td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </Section>
        );
      })}

      <footer className="mt-8 border-t border-border pt-2 text-[10.5px] text-ink-300">
        {property.name} · {group.name} · Unit interior renovation scope
      </footer>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-300">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-semibold text-navy">{value}</dd>
    </div>
  );
}

function Section({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 break-inside-avoid">
      <h2 className="mb-2 border-b border-border pb-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-400">
        {number} — {title}
      </h2>
      {children}
    </section>
  );
}

function Th({ children, align }: { children?: React.ReactNode; align?: "right" }) {
  return (
    <th
      className={`border-b border-ink-100 pb-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-300 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  className,
}: {
  children?: React.ReactNode;
  align?: "right";
  className?: string;
}) {
  return (
    <td
      className={`py-1 align-top ${align === "right" ? "text-right tabular-nums" : ""} ${className ?? ""}`}
    >
      {children}
    </td>
  );
}
