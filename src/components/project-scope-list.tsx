"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, LockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ComboboxSelect } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BudgetInlineEditor } from "@/components/budget-inline-editor";
import { ProjectPanelSwitch } from "@/components/project-work-panels";
import {
  DescriptionEditor,
  OutForBidChip,
  SpecsEditor,
} from "@/components/scope-inline-editors";
import { createScopeItem, deleteScopeItem, restoreScopeItem, updateScopeItem } from "@/lib/actions/scope";
import { confirmScope, unconfirmScope } from "@/lib/actions/scope-confirm";
import { fmtDate, initials, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { scopeLineTotal as lineTotal } from "@/lib/scope-total";

export type SpecGrid = { cols: string[]; rows: string[][] };

export type ScopeRow = {
  id: number;
  item: string;
  materialQuality: string | null;
  status: string;
  quantity: string | null;
  unitPrice: string | null;
  costCodeId: number | null;
  vendorId: number | null;
  startDate: string | null;
  endDate: string | null;
  specs: SpecGrid | null;
};

export type ScopeCostCodeOption = { id: number; code: string; name: string };
export type ScopeVendorOption = { id: number; name: string; trade: string | null };

/** Underwriting budget for a cost code, and everything already allocated to it property-wide. */
export type CostCodeBudget = { budget: number; allocated: number };

const DEFAULT_SPEC_COLS = ["Item", "Product", "Notes"];

/** Shared grid so the column header, every row, and the total line up. */
const GRID = "grid grid-cols-[minmax(0,1fr)_120px_120px_120px] items-baseline gap-3.5";

const LABEL = "text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink-300";

/** A scope line with everything the row needs resolved onto it. */
type Line = {
  row: ScopeRow;
  vendor: ScopeVendorOption | null;
  code: ScopeCostCodeOption | null;
  /** The UW allowance on this line's code. */
  allowance: number;
  /** Posted spend on this line's code. */
  actual: number;
  /** How many scope lines share this code — 1 means the figure is this line's. */
  sharing: number;
  /** A vendor is currently pricing this line, so its priced fields are frozen. */
  outForBid: boolean;
  budgeted: number | null;
  committed: number | null;
};

export function ProjectScopeList({
  propertyId,
  projectId,
  items,
  costCodes,
  vendors,
  actualByCode,
  budgetByCode,
  approvedBudget,
  committedByLine,
  awardIsDirect,
  scopeConfirmedAt,
  scopeLocked,
  liveRfpCount,
  outForBidLineIds,
  perUnitBudgetByCode,
  tierName,
}: {
  propertyId: number;
  projectId: number;
  items: ScopeRow[];
  costCodes: ScopeCostCodeOption[];
  vendors: ScopeVendorOption[];
  actualByCode: Record<number, number>;
  budgetByCode: Record<number, CostCodeBudget>;
  approvedBudget: number;
  /** What an awarded vendor is on the hook for, per scope line. */
  committedByLine: Record<number, number>;
  /** A direct award puts its whole amount on one line, so committed is lumpy. */
  awardIsDirect: boolean;
  scopeConfirmedAt: string | null;
  scopeLocked: boolean;
  liveRfpCount: number;
  /** Lines a vendor is holding right now. An RFP can cover a subset of the scope. */
  outForBidLineIds: number[];
  /** Per-unit tier allowance by code. Null on common-area projects. */
  perUnitBudgetByCode: Record<number, number> | null;
  tierName: string | null;
}) {
  const costCodeOptions = useMemo(
    () => costCodes.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
    [costCodes],
  );
  const vendorById = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);
  const codeById = useMemo(() => new Map(costCodes.map((c) => [c.id, c])), [costCodes]);

  // Editing happens in a dialog rather than an inline panel, so one line is open
  // at a time. `null` = closed, a number = that row, "new" = a line being
  // created, which has no row in the table until it is saved.
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const editingRow = typeof editing === "number" ? items.find((i) => i.id === editing) ?? null : null;

  const outForBid = useMemo(() => new Set(outForBidLineIds), [outForBidLineIds]);

  const lines = useMemo<Line[]>(() => {
    // Several scope lines may point at one cost code, and that is fine — but it
    // decides whether posted spend can be read as this line's or only as the
    // code's, so it is counted before anything is rendered.
    const sharing = new Map<number, number>();
    for (const r of items) {
      if (r.costCodeId == null) continue;
      sharing.set(r.costCodeId, (sharing.get(r.costCodeId) ?? 0) + 1);
    }

    const built = items.map<Line>((row) => {
      const code = row.costCodeId != null ? codeById.get(row.costCodeId) ?? null : null;
      return {
        row,
        vendor: row.vendorId != null ? vendorById.get(row.vendorId) ?? null : null,
        code,
        // On a unit turn the allowance is the tier's per-unit line; on a
        // common-area project it is the property's underwritten figure.
        allowance:
          row.costCodeId == null
            ? 0
            : perUnitBudgetByCode
              ? (perUnitBudgetByCode[row.costCodeId] ?? 0)
              : (budgetByCode[row.costCodeId]?.budget ?? 0),
        actual: row.costCodeId != null ? (actualByCode[row.costCodeId] ?? 0) : 0,
        sharing: row.costCodeId != null ? (sharing.get(row.costCodeId) ?? 1) : 1,
        outForBid: outForBid.has(row.id),
        budgeted: lineTotal(row),
        committed: committedByLine[row.id] ?? null,
      };
    });

    // By code, so lines sharing one sit together without needing a header to say
    // so. Uncoded last: it is the pile that still needs a decision, and burying
    // it mid-table is how it stays unresolved.
    return built.sort((a, b) => {
      if (!a.code && !b.code) return 0;
      if (!a.code) return 1;
      if (!b.code) return -1;
      return a.code.code.localeCompare(b.code.code);
    });
  }, [items, codeById, vendorById, budgetByCode, actualByCode, committedByLine, outForBid, perUnitBudgetByCode]);

  const vendorCount = new Set(items.map((i) => i.vendorId).filter((v) => v != null)).size;
  const pricedCount = lines.filter((l) => l.budgeted != null).length;
  const budgetedTotal = lines.reduce((s, l) => s + (l.budgeted ?? 0), 0);
  const committedTotal = lines.reduce((s, l) => s + (l.committed ?? 0), 0);

  // Once per code, not once per line — two lines on one code would otherwise
  // count the same posted dollars twice.
  const actualInScope = useMemo(() => {
    const seen = new Set<number>();
    let sum = 0;
    for (const l of lines) {
      if (l.row.costCodeId == null || seen.has(l.row.costCodeId)) continue;
      seen.add(l.row.costCodeId);
      sum += l.actual;
    }
    return sum;
  }, [lines]);

  const actualEverywhere = Object.values(actualByCode).reduce((s, v) => s + v, 0);
  const actualOutsideScope = Math.max(0, actualEverywhere - actualInScope);
  const overApproved = approvedBudget > 0 && budgetedTotal > approvedBudget;

  return (
    <Card className="gap-0 overflow-hidden">
      <CardHeader className="flex flex-row flex-wrap items-center gap-x-3 gap-y-2 pb-(--card-spacing)">
        <ProjectPanelSwitch />

        <span className="text-[13px] text-ink-400">
          {items.length} item{items.length === 1 ? "" : "s"}
          {vendorCount > 0 && ` · ${vendorCount} vendor${vendorCount === 1 ? "" : "s"}`}
          {budgetedTotal > 0 && (
            <>
              {" · "}
              <span className="font-semibold text-ink-700 tabular-nums">{money(budgetedTotal)}</span>
              {" budgeted"}
              {approvedBudget > 0 && ` of ${money(approvedBudget)} approved`}
            </>
          )}
        </span>

        {/* The budget lived on a stat card above this table. That card is gone and
            confirming requires a budget, so the control sits where the
            requirement is felt rather than two clicks away in Manage. */}
        <BudgetInlineEditor projectId={projectId} approved={approvedBudget} />

        {overApproved && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-alert/10 px-2 py-0.5 text-[11.5px] font-semibold text-alert">
            {money(budgetedTotal - approvedBudget)} over the approved budget
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <ScopeConfirmControl
            projectId={projectId}
            confirmedAt={scopeConfirmedAt}
            locked={scopeLocked}
            liveRfpCount={liveRfpCount}
          />
          <Button size="sm" disabled={scopeLocked} onClick={() => setEditing("new")}>
            Add scope item
          </Button>
        </div>
      </CardHeader>

      {items.length === 0 ? (
        <p className="border-t border-border py-10 text-center text-sm text-muted-foreground">
          No scope items yet — add the first with “Add scope item”.
        </p>
      ) : (
        <>
          <div className={cn(GRID, "border-y border-border px-5 py-2", LABEL)}>
            <div>Scope item</div>
            <div className="text-right">Budgeted</div>
            <div className="text-right">Committed</div>
            <div className="text-right">Actual</div>
          </div>

          {lines.map((line) => (
            <ScopeLineRow
              key={line.row.id}
              line={line}
              awardIsDirect={awardIsDirect}
              propertyId={propertyId}
              projectId={projectId}
              perUnit={perUnitBudgetByCode != null}
              tierName={tierName}
              liveRfpCount={liveRfpCount}
              onOpen={() => setEditing(line.row.id)}
            />
          ))}

          <div className={cn(GRID, "border-t border-border bg-band px-5 py-3")}>
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-500">
              Total · {items.length} item{items.length === 1 ? "" : "s"} · {pricedCount} priced
            </div>
            <div
              className={cn(
                "text-right text-[15px] font-bold tabular-nums",
                overApproved ? "text-alert" : "text-ink-900",
              )}
            >
              {budgetedTotal > 0 ? money(budgetedTotal) : "—"}
            </div>
            <div className="text-right text-[15px] font-bold tabular-nums text-ink-900">
              {committedTotal > 0 ? money(committedTotal) : "—"}
            </div>
            <div className="text-right text-[15px] font-bold tabular-nums text-ink-900">
              {actualInScope > 0 ? money(actualInScope) : "$0"}
            </div>
          </div>

          {actualOutsideScope > 0 && (
            // Real posted spend on codes nothing in this scope points at. Folding
            // it into the total would make the column stop adding up; hiding it
            // would lose the fact that money is going somewhere the scope never
            // described.
            <div className="border-t border-hairline bg-alert-bg/40 px-5 py-2 text-[11.5px] text-alert">
              {money(actualOutsideScope)} also posted to budget lines this scope does not cover
            </div>
          )}
        </>
      )}

      {editing !== null && (
        <ScopeEditorDialog
          // Remount per line so the form always initializes from that row.
          key={typeof editing === "number" ? editing : "new"}
          row={editingRow}
          propertyId={propertyId}
          projectId={projectId}
          costCodeOptions={costCodeOptions}
          vendorById={vendorById}
          budgetByCode={budgetByCode}
          actualByCode={actualByCode}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

/**
 * One scope line. The cost code rides on the row rather than heading a section.
 *
 * Grouping by code put a full band above every line, and with one line per code
 * — which is most of them — the band restated the row beneath it, name and
 * figure both. The code is a property of the line, so it reads as one.
 */
function ScopeLineRow({
  line,
  awardIsDirect,
  propertyId,
  projectId,
  perUnit,
  tierName,
  liveRfpCount,
  onOpen,
}: {
  line: Line;
  awardIsDirect: boolean;
  propertyId: number;
  projectId: number;
  /** True on a unit turn, where the allowance is per unit rather than property-wide. */
  perUnit: boolean;
  tierName: string | null;
  liveRfpCount: number;
  onOpen: () => void;
}) {
  const { row, vendor, code, allowance, actual, sharing, budgeted, committed } = line;

  const qty = row.quantity ? Number(row.quantity) : null;
  const unit = row.unitPrice ? Number(row.unitPrice) : null;
  // Over what was estimated. Only meaningful when a vendor priced this line, so
  // a direct award — whose whole amount lands on one line by design — is left out.
  const over =
    !awardIsDirect && budgeted != null && committed != null && committed > budgeted
      ? committed - budgeted
      : null;

  // Against the code's allowance. Only this line's share is knowable when it is
  // the only line on the code; otherwise the comparison belongs to the code.
  const remaining = allowance > 0 && budgeted != null && sharing === 1 ? allowance - budgeted : null;
  const unbudgeted = code != null && allowance === 0 && budgeted != null && budgeted > 0;
  const frozen = line.outForBid;

  const specRows = row.specs?.rows.filter((r) => r.some((c) => c.trim())) ?? [];
  const description = row.materialQuality?.trim() ?? "";
  // A row with nothing to say should not cost a full sentence of placeholder and
  // an empty spec band. Most lines start empty, so paying three bands for every
  // one of them is what made a thirty-item scope unreadable.
  const bare = !description && specRows.length === 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full cursor-pointer border-b border-hairline px-5 py-3 text-left transition-colors hover:bg-hover"
    >
      <div className={GRID}>
        <div className="min-w-0">
          <div className="truncate text-[10px] font-semibold tracking-[0.05em] text-ink-300">
            {code ? (
              <>
                <span className="font-plex-mono">{code.code}</span>
                <span className="text-ink-400"> · {code.name} · </span>
                {allowance > 0 ? (
                  <span>
                    {money(allowance)} {perUnit ? "per unit" : "allowance"}
                  </span>
                ) : (
                  <span className="font-bold text-gold">
                    {perUnit
                      ? `not in the ${tierName ?? "tier"} tier`
                      : "no allowance on this code"}
                  </span>
                )}
                {sharing > 1 && <span className="text-ink-300"> · {sharing} lines on this code</span>}
              </>
            ) : (
              <span className="font-bold text-alert">NOT CODED TO A BUDGET LINE</span>
            )}
          </div>

          <div className="mt-0.5 flex items-center gap-2">
            <span className="truncate text-sm font-semibold leading-snug text-navy">
              {row.item || "Untitled item"}
            </span>
            {frozen && <OutForBidChip vendors={liveRfpCount} />}
          </div>

          {vendor ? (
            <div className="mt-1 flex items-center gap-1.5">
              <span className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-[#c3d3ec] bg-[#dde6f5] text-[8.5px] font-bold text-[#1b3a6b]">
                {initials(vendor.name)}
              </span>
              <span className="truncate text-[11.5px] text-ink-400">
                {vendor.name}
                {vendor.trade ? ` · ${vendor.trade}` : ""}
              </span>
            </div>
          ) : (
            <div className="mt-1 text-[11.5px] text-ink-300">Awaiting award</div>
          )}
        </div>

        <div className="text-right">
          <div
            className={cn(
              "text-sm font-semibold tabular-nums tracking-[-0.01em]",
              budgeted == null ? "text-ink-200" : unbudgeted ? "text-gold" : "text-navy",
            )}
          >
            {budgeted != null ? money(budgeted) : "Not priced"}
          </div>
          {unbudgeted ? (
            <div className="mt-px text-[10.5px] font-semibold text-gold">unbudgeted</div>
          ) : remaining != null ? (
            <div
              className={cn(
                "mt-px text-[10.5px] tabular-nums",
                remaining < 0 ? "text-alert" : remaining === 0 ? "text-positive" : "text-ink-400",
              )}
            >
              {remaining < 0
                ? `${money(-remaining)} over${perUnit ? " tier" : ""}`
                : remaining === 0
                  ? perUnit
                    ? "on tier"
                    : "fully allocated"
                  : perUnit
                    ? `${money(remaining)} under tier`
                    : `${money(remaining)} left`}
            </div>
          ) : (
            qty != null &&
            unit != null && (
              <div className="mt-px text-[10.5px] tabular-nums text-ink-300">
                {qty.toLocaleString()} × {money(unit)}
              </div>
            )
          )}
        </div>

        <div className="text-right">
          {committed != null && committed > 0 ? (
            <>
              <div className="text-sm font-medium tabular-nums text-ink-700">{money(committed)}</div>
              {over != null && (
                <div className="mt-px text-[10.5px] tabular-nums text-alert">{money(over)} over</div>
              )}
            </>
          ) : (
            <span className="text-xs text-ink-100">·</span>
          )}
        </div>

        <div className="text-right">
          {row.costCodeId == null ? (
            <span className="text-xs text-ink-100">·</span>
          ) : (
            <>
              <div
                className={cn(
                  "text-sm tabular-nums",
                  actual > 0 ? "font-medium text-ink-700" : "text-ink-200",
                )}
              >
                {actual > 0 ? money(actual) : "$0"}
              </div>
              {sharing > 1 && actual > 0 && (
                // Posted spend is a cost-code fact. With more than one line on the
                // code, nothing says how to split it, so the row shows the code's
                // figure and says so rather than implying it is this line's.
                <div className="mt-px text-[10.5px] text-ink-300">code total</div>
              )}
            </>
          )}
        </div>
      </div>

      {description && (
        <DescriptionEditor
          scopeItemId={row.id}
          propertyId={propertyId}
          projectId={projectId}
          value={description}
          outForBid={frozen}
          vendorsPricing={liveRfpCount}
        >
          <p className="mt-2 max-w-[68ch] px-1 text-[12.5px] leading-relaxed text-ink-500">
            {description}
          </p>
        </DescriptionEditor>
      )}

      {specRows.length > 0 && (
        <SpecsEditor
          scopeItemId={row.id}
          propertyId={propertyId}
          projectId={projectId}
          specs={row.specs}
          outForBid={frozen}
          vendorsPricing={liveRfpCount}
        >
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            {specRows.slice(0, 4).map((cells, i) => (
              <span
                key={i}
                className="inline-flex max-w-full items-baseline gap-1.5 rounded-[5px] border border-border bg-card px-[7px] py-0.5 text-[11px] transition-colors hover:border-ink-200"
              >
                <span className="font-semibold text-ink-400">{cells[0] || "—"}</span>
                <span className="truncate text-ink-700">
                  {cells.slice(1).filter(Boolean).join(" · ")}
                </span>
              </span>
            ))}
            {specRows.length > 4 && (
              <span className="text-[11px] text-ink-400">+{specRows.length - 4} more</span>
            )}
          </span>
        </SpecsEditor>
      )}

      {/* Whichever half is missing gets its own way in, so a line is never one
          click from the dialog just to add a sentence. */}
      {(bare || (!description && specRows.length > 0) || (description && specRows.length === 0)) && (
        <div className="mt-1.5 flex gap-3 text-[11.5px] text-ink-200">
          {!description && (
            <DescriptionEditor
              scopeItemId={row.id}
              propertyId={propertyId}
              projectId={projectId}
              value=""
              outForBid={frozen}
              vendorsPricing={liveRfpCount}
            >
              <span className="underline underline-offset-[3px] transition-colors hover:text-ink-500">
                Add description
              </span>
            </DescriptionEditor>
          )}
          {specRows.length === 0 && (
            <SpecsEditor
              scopeItemId={row.id}
              propertyId={propertyId}
              projectId={projectId}
              specs={row.specs}
              outForBid={frozen}
              vendorsPricing={liveRfpCount}
            >
              <span className="underline underline-offset-[3px] transition-colors hover:text-ink-500">
                Add specs
              </span>
            </SpecsEditor>
          )}
        </div>
      )}
    </button>
  );
}

/**
 * Confirm the scope, compactly.
 *
 * This was a full-width bar with a switch under the card header. The capability
 * matters — confirming here writes the same projects.scope_confirmed_at the
 * workflow gate reads, so either door ticks gate 2 — but a banner across the
 * table to hold one control was most of what made the header feel busy.
 */
function ScopeConfirmControl({
  projectId,
  confirmedAt,
  locked,
  liveRfpCount,
}: {
  projectId: number;
  confirmedAt: string | null;
  locked: boolean;
  liveRfpCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "That did not work");
        return;
      }
      toast.success(success);
      router.refresh();
    });
  }

  // Frozen because vendors are holding the scope. Not a button: the way back is
  // withdrawing the requests, which the workflow panel owns.
  if (locked) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-md bg-gold/12 px-2.5 py-1 text-[11.5px] font-semibold text-[#7a6414]"
        title={`Prices, codes and specs are frozen while ${liveRfpCount} vendor${liveRfpCount === 1 ? " is" : "s are"} pricing. Dates stay editable.`}
      >
        <LockIcon className="size-3" />
        Locked · {liveRfpCount} pricing
      </span>
    );
  }

  if (confirmedAt) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => unconfirmScope({ projectId }), "Scope re-opened for editing")}
        className="inline-flex items-center gap-1.5 rounded-md bg-positive-bg px-2.5 py-1 text-[11.5px] font-semibold text-positive transition-colors hover:bg-positive/15 disabled:opacity-60"
        title="Un-confirm to keep editing"
      >
        <CheckIcon className="size-3" />
        Confirmed {fmtDate(confirmedAt)}
      </button>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => run(() => confirmScope({ projectId }), "Scope confirmed — ready to price")}
    >
      Confirm scope
    </Button>
  );
}

function ScopeEditorDialog({
  row,
  propertyId,
  projectId,
  costCodeOptions,
  vendorById,
  budgetByCode,
  actualByCode,
  onClose,
}: {
  row: ScopeRow | null;
  propertyId: number;
  projectId: number;
  costCodeOptions: { value: number; label: string }[];
  vendorById: Map<number, ScopeVendorOption>;
  budgetByCode: Record<number, CostCodeBudget>;
  actualByCode: Record<number, number>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [id, setId] = useState<number | null>(row?.id ?? null);
  const [item, setItem] = useState(row?.item ?? "");
  const [materialQuality, setMaterialQuality] = useState(row?.materialQuality ?? "");
  const [quantity, setQuantity] = useState(row?.quantity ?? "");
  const [unitPrice, setUnitPrice] = useState(row?.unitPrice ?? "");
  const [costCodeId, setCostCodeId] = useState<number | null>(row?.costCodeId ?? null);
  // Read-only: the award that covers this line owns it. See applyAwardVendor.
  const vendorId = row?.vendorId ?? null;
  const [startDate, setStartDate] = useState(row?.startDate ?? "");
  const [endDate, setEndDate] = useState(row?.endDate ?? "");
  const [specs, setSpecs] = useState<SpecGrid>(row?.specs ?? { cols: DEFAULT_SPEC_COLS, rows: [] });

  // Fixed snapshot of what this row originally contributed to its budget code,
  // so the remaining-budget figure doesn't double-count this row's own spend.
  const originalCostCodeId = row?.costCodeId ?? null;
  const originalTotal = Number(row?.quantity ?? 0) * Number(row?.unitPrice ?? 0);

  type FieldPatch = Partial<{
    item: string;
    materialQuality: string;
    quantity: string;
    unitPrice: string;
    costCodeId: number | null;
    startDate: string;
    endDate: string;
    specs: SpecGrid;
  }>;

  function commit(patch: FieldPatch) {
    const next = {
      item: patch.item ?? item,
      materialQuality: patch.materialQuality ?? materialQuality,
      quantity: patch.quantity ?? quantity,
      unitPrice: patch.unitPrice ?? unitPrice,
      costCodeId: patch.costCodeId !== undefined ? patch.costCodeId : costCodeId,
      startDate: patch.startDate ?? startDate,
      endDate: patch.endDate ?? endDate,
      specs: patch.specs ?? specs,
    };
    startTransition(async () => {
      if (id == null) {
        if (!next.item.trim()) return; // nothing to create until there's an item name
        const res = await createScopeItem({
          propertyId,
          projectId,
          item: next.item,
          materialQuality: next.materialQuality || null,
          quantity: next.quantity || null,
          unitPrice: next.unitPrice || null,
          costCodeId: next.costCodeId,
          startDate: next.startDate || null,
          endDate: next.endDate || null,
          specs: next.specs.rows.length ? next.specs : null,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        setId(res.id);
        router.refresh();
        return;
      }
      const res = await updateScopeItem({ id, propertyId, projectId, ...patch });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  function handleDelete() {
    if (id == null) {
      onClose();
      return;
    }
    startTransition(async () => {
      const res = await deleteScopeItem({ id, propertyId, projectId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Scope item deleted", {
        action: {
          label: "Undo",
          onClick: () => {
            startTransition(async () => {
              const undo = await restoreScopeItem({ id, propertyId, projectId });
              if (!undo.ok) toast.error(undo.error);
              router.refresh();
            });
          },
        },
      });
      onClose();
      router.refresh();
    });
  }

  function setSpecCell(ri: number, ci: number, value: string) {
    setSpecs({
      cols: specs.cols,
      rows: specs.rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? value : c)) : r)),
    });
  }

  function addSpecRow() {
    setSpecs({ cols: specs.cols, rows: [...specs.rows.map((r) => r.slice()), specs.cols.map(() => "")] });
  }

  const total = quantity && unitPrice ? Number(quantity) * Number(unitPrice) : null;
  const actual = costCodeId != null ? actualByCode[costCodeId] ?? 0 : 0;

  const budget = costCodeId != null ? budgetByCode[costCodeId] : undefined;
  const ownOriginal = originalCostCodeId === costCodeId ? originalTotal : 0;
  const remaining = budget ? budget.budget - (budget.allocated - ownOriginal) - (total ?? 0) : null;
  const overBudget = remaining != null && remaining < 0;
  const vendor = vendorId != null ? vendorById.get(vendorId) ?? null : null;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{item || "New scope item"}</DialogTitle>
          <DialogDescription>
            {id == null
              ? "Give the line a name to create it — changes save as you go."
              : "Changes save as you go."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          {/* Left column — narrative, fields, product specs */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className={LABEL}>Scope narrative</Label>
              <Textarea
                className="min-h-20 text-sm"
                rows={3}
                value={materialQuality}
                placeholder="What the contractor is responsible for on this line."
                onChange={(e) => setMaterialQuality(e.target.value)}
                onBlur={() => commit({ materialQuality })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Item">
                <Input
                  className="h-8 text-xs"
                  value={item}
                  placeholder="Item name"
                  onChange={(e) => setItem(e.target.value)}
                  onBlur={() => commit({ item })}
                />
              </Field>
              <Field label="Budget line">
                <ComboboxSelect
                  options={costCodeOptions}
                  value={costCodeId}
                  placeholder="Search codes…"
                  emptyMessage="No matching cost codes"
                  onValueChange={(next) => {
                    setCostCodeId(next);
                    commit({ costCodeId: next });
                  }}
                />
              </Field>
              <Field label="Start">
                <Input
                  className="h-8 text-xs"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  onBlur={() => commit({ startDate })}
                />
              </Field>
              <Field label="Units">
                <Input
                  className="h-8 text-right text-xs"
                  type="number"
                  step="0.01"
                  value={quantity}
                  placeholder="1"
                  onChange={(e) => setQuantity(e.target.value)}
                  onBlur={() => commit({ quantity })}
                />
              </Field>
              <Field label="Unit cost">
                <Input
                  className="h-8 text-right text-xs"
                  type="number"
                  step="0.01"
                  value={unitPrice}
                  placeholder="0.00"
                  onChange={(e) => setUnitPrice(e.target.value)}
                  onBlur={() => commit({ unitPrice })}
                />
              </Field>
              <Field label="End">
                <Input
                  className="h-8 text-xs"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  onBlur={() => commit({ endDate })}
                />
              </Field>
            </div>

            <div className="space-y-1.5">
              <Label className={LABEL}>Product specifications</Label>
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-muted/40">
                      {specs.cols.map((c) => (
                        <th key={c} className={cn("px-3 py-2 text-left", LABEL)}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {specs.rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={specs.cols.length}
                          className="px-3 py-3 text-center text-xs text-muted-foreground"
                        >
                          No specifications yet.
                        </td>
                      </tr>
                    ) : (
                      specs.rows.map((r, ri) => (
                        <tr key={ri} className="border-t border-border">
                          {specs.cols.map((c, ci) => (
                            <td key={c} className="px-2 py-1.5">
                              <Input
                                className="h-7 border-transparent text-xs shadow-none hover:border-input"
                                value={r[ci] ?? ""}
                                placeholder={c}
                                onChange={(e) => setSpecCell(ri, ci, e.target.value)}
                                onBlur={() => commit({ specs })}
                              />
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between pt-1">
                <Button size="sm" variant="ghost" onClick={addSpecRow}>
                  Add spec row
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-alert hover:text-alert"
                  disabled={pending}
                  onClick={handleDelete}
                >
                  {id == null ? "Discard" : "Delete scope item"}
                </Button>
              </div>
            </div>
          </div>

          {/* Right rail — money, budget check, vendor */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-card">
              <div className="border-r border-border px-3 py-2.5">
                <div className={LABEL}>Total cost</div>
                <div className="mt-1 text-sm font-semibold tabular-nums text-navy">
                  {total != null ? money(total) : "—"}
                </div>
              </div>
              <div className="px-3 py-2.5">
                <div className={LABEL}>Reconciled</div>
                <div className="mt-1 text-sm font-semibold tabular-nums text-navy">
                  {actual > 0 ? money(actual) : "—"}
                </div>
              </div>
            </div>

            {budget && (
              <div
                className={cn(
                  "rounded-lg border px-3 py-2.5",
                  overBudget ? "border-alert/30 bg-alert/5" : "border-border bg-card",
                )}
              >
                <div className={cn(LABEL, overBudget && "text-alert")}>Budget check</div>
                <p
                  className={cn(
                    "mt-1.5 text-xs leading-relaxed",
                    overBudget ? "text-alert" : "text-muted-foreground",
                  )}
                >
                  {overBudget
                    ? `This line puts the budget code ${money(Math.abs(remaining!))} over its ${money(budget.budget)} allowance. Confirm the approval before releasing a contract.`
                    : `${money(remaining ?? 0)} left of the ${money(budget.budget)} allowance on this code.`}
                </p>
              </div>
            )}

            {vendor ? (
              <div className="space-y-3 rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[#c3d3ec] bg-[#dde6f5] text-xs font-bold text-[#1b3a6b]">
                    {initials(vendor.name)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-navy">{vendor.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{vendor.trade ?? "Vendor"}</div>
                  </div>
                </div>
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  Set by the award covering this line. To change it, award a different bid from the
                  project&rsquo;s Workflow panel.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 rounded-lg border border-dashed border-border bg-card p-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  No vendor yet. One is set when a bid covering this line is awarded.
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className={LABEL}>{label}</Label>
      {children}
    </div>
  );
}
