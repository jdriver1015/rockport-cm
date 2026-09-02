"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CapitalByPhase, DeploymentCurve } from "@/lib/exec-capital";

/**
 * The executive tab's two capital views, behind a pill switcher.
 *
 * Client-side because both charts carry a hover layer — a chart drawn in SVG is
 * interactive by nature, and the numbers here are the point, so they are
 * readable per-mark rather than only by eyeballing a height.
 *
 * Colours come from the data-viz reference categorical palette, in slot order.
 * That order is the colour-blind-safety mechanism, not decoration: the sequence
 * was validated for adjacent-pair separation — the pairlist that governs stacks
 * and lines — so slots must not be reordered or cycled, and an eighth category
 * folds into "Other" rather than inventing a hue.
 *
 * Three slots sit under 3:1 against a light surface, which obliges the relief
 * the validator asks for — hence the always-visible figures table under the
 * stacked bars.
 */

const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7"];

/**
 * Light steps only, on purpose. This app has no active dark theme — its dark
 * block is gated on a `.dark` class nothing sets, and the brand tokens redefine
 * `--card` to white after it — so the chart surface is always light. Swapping
 * palettes on `prefers-color-scheme` would paint dark-surface hues onto a white
 * card whenever the viewer's OS is dark, which is worse than not switching: the
 * dark steps were validated against #1a1a19, not white.
 *
 * If a real dark theme is ever added, the matching validated steps are:
 * #3987e5, #d95926, #199e70, #c98500, #d55181, #008300, #9085e9 — swap them in
 * under the same selector the theme uses, and re-run the palette validator
 * against that surface rather than assuming they still pass.
 */
const VIZ_CSS = `
.viz {
  --viz-surface: var(--color-card);
  --series-1: ${SERIES[0]};
  --series-2: ${SERIES[1]};
  --series-3: ${SERIES[2]};
  --series-4: ${SERIES[3]};
  --series-5: ${SERIES[4]};
  --series-6: ${SERIES[5]};
  --series-7: ${SERIES[6]};
}
`;

const slot = (i: number) => `var(--series-${(i % 7) + 1})`;

const W = 920;
const PAD = { top: 18, right: 24, bottom: 40, left: 78 };
const GAP = 2; // surface gap between touching marks
const R = 4; // rounded data-end

const money = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`;
const exact = (v: number) => `$${Math.round(v).toLocaleString()}`;

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const step = mag / 2;
  return Math.ceil(v / step) * step;
}

/** Square at the baseline, rounded at the data end. */
function topRoundedPath(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h, w / 2);
  return (
    `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} ` +
    `L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`
  );
}

type Hover = { x: number; y: number; rows: { label: string; value: string; color?: string }[]; title: string };

function Tooltip({ hover }: { hover: Hover }) {
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-card border border-border bg-card px-2.5 py-1.5 text-[11.5px] shadow-md"
      style={{ left: `${hover.x}%`, top: hover.y, transform: "translate(-50%, -100%)" }}
    >
      <div className="mb-0.5 font-semibold text-navy">{hover.title}</div>
      {hover.rows.map((r) => (
        <div key={r.label} className="flex items-center gap-1.5 whitespace-nowrap">
          {r.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} />}
          <span className="text-muted-foreground">{r.label}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums text-foreground">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5" style={{ paddingLeft: PAD.left }}>
      {items.map((s) => (
        <span key={s.label} className="flex items-center gap-1.5 text-[11.5px] text-ink-600">
          <svg width="18" height="8" aria-hidden>
            <line
              x1="0" y1="4" x2="18" y2="4" stroke={s.color} strokeWidth={2.5}
              strokeDasharray={s.dashed ? "5 3" : undefined} strokeLinecap="round"
            />
          </svg>
          {s.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PhaseChart({ data }: { data: CapitalByPhase }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const H = 300;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const yMax = niceCeil(Math.max(...data.stacks.map((s) => s.total), 1));
  const sy = (v: number) => PAD.top + plotH - (v / yMax) * plotH;
  const band = plotW / data.stacks.length;
  const barW = Math.min(24, band * 0.42);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax);

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label="Capital by phase, split by cost category">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)}
              stroke="var(--color-hairline)" strokeWidth={1} />
            <text x={PAD.left - 10} y={sy(t) + 4} textAnchor="end"
              className="fill-[var(--color-ink-400)] text-[11px] tabular-nums">{money(t)}</text>
          </g>
        ))}

        {data.stacks.map((stack, si) => {
          const cx = PAD.left + band * si + band / 2;
          const x = cx - barW / 2;
          // Drawn from the baseline up, so the gap always eats into the segment
          // above and the bar still meets the axis cleanly.
          let cursor = sy(0);
          const topIndex = stack.values.reduce((acc, v, i) => (v > 0 ? i : acc), -1);
          return (
            <g key={stack.phase}>
              {stack.values.map((v, ci) => {
                if (v <= 0) return null;
                const full = (v / yMax) * plotH;
                const isTop = ci === topIndex;
                const h = Math.max(1, full - (isTop ? 0 : GAP));
                const y = cursor - full;
                cursor -= full;
                const color = slot(ci);
                const common = {
                  fill: color,
                  onMouseEnter: () =>
                    setHover({
                      x: (cx / W) * 100, y: y + PAD.top - 4, title: stack.label,
                      rows: [
                        { label: data.categories[ci], value: exact(v), color },
                        { label: "Phase total", value: exact(stack.total) },
                      ],
                    }),
                  onMouseLeave: () => setHover(null),
                };
                return isTop ? (
                  <path key={ci} d={topRoundedPath(x, y, barW, h, R)} {...common} />
                ) : (
                  <rect key={ci} x={x} y={y + GAP} width={barW} height={h} {...common} />
                );
              })}
              {stack.total > 0 && (
                <text x={cx} y={sy(stack.total) - 8} textAnchor="middle"
                  className="fill-[var(--color-ink-700)] text-[11.5px] font-semibold tabular-nums">
                  {money(stack.total)}
                </text>
              )}
              <text x={cx} y={H - 14} textAnchor="middle"
                className="fill-[var(--color-ink-400)] text-[11.5px]">{stack.label}</text>
            </g>
          );
        })}
      </svg>
      <Legend items={data.categories.map((c, i) => ({ label: c, color: slot(i) }))} />
      {hover && <Tooltip hover={hover} />}
    </div>
  );
}

/** The relief the validator asks for: the figures, visible without hovering. */
function PhaseTable({ data }: { data: CapitalByPhase }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Category</TableHead>
            {data.stacks.map((s) => <TableHead key={s.phase} className="text-right">{s.label}</TableHead>)}
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.categories.map((c, ci) => {
            const total = data.stacks.reduce((sum, s) => sum + s.values[ci], 0);
            return (
              <TableRow key={c}>
                <TableCell className="font-medium">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
                    style={{ background: slot(ci) }} />
                  {c}
                </TableCell>
                {data.stacks.map((s) => (
                  <TableCell key={s.phase} className="text-right tabular-nums">
                    {s.values[ci] > 0 ? exact(s.values[ci]) : "—"}
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium tabular-nums">{exact(total)}</TableCell>
              </TableRow>
            );
          })}
          <TableRow className="font-medium">
            <TableCell>Total</TableCell>
            {data.stacks.map((s) => (
              <TableCell key={s.phase} className="text-right tabular-nums">
                {s.total > 0 ? exact(s.total) : "—"}
              </TableCell>
            ))}
            <TableCell className="text-right tabular-nums">{exact(data.total)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CurveChart({ data }: { data: DeploymentCurve }) {
  const [at, setAt] = useState<number | null>(null);
  const H = 300;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const pts = data.points;
  const lastX = Math.max(1, pts.length - 1);
  const yMax = niceCeil(Math.max(data.budgetTotal, ...pts.map((p) => p.scheduled), 1));
  const sx = (i: number) => PAD.left + (i / lastX) * plotW;
  const sy = (v: number) => PAD.top + plotH - (v / yMax) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax);
  // Roughly six labels, whatever the span.
  const every = Math.max(1, Math.round(pts.length / 6));

  const line = (key: "underwritten" | "scheduled") =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${sx(i)},${sy(p[key])}`).join(" ");

  const hovered = at == null ? null : pts[at];

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label="Cumulative capital deployment, underwritten against scheduled"
        onMouseLeave={() => setAt(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - PAD.left) / plotW) * lastX);
          setAt(i >= 0 && i <= lastX ? i : null);
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)}
              stroke="var(--color-hairline)" strokeWidth={1} />
            <text x={PAD.left - 10} y={sy(t) + 4} textAnchor="end"
              className="fill-[var(--color-ink-400)] text-[11px] tabular-nums">{money(t)}</text>
          </g>
        ))}

        {pts.map((p, i) =>
          i % every === 0 ? (
            <text key={p.month} x={sx(i)} y={H - 14} textAnchor="middle"
              className="fill-[var(--color-ink-400)] text-[11px]">{p.label}</text>
          ) : null,
        )}

        {data.todayIndex >= 0 && (
          <g>
            <line x1={sx(data.todayIndex)} x2={sx(data.todayIndex)} y1={PAD.top} y2={PAD.top + plotH}
              stroke="var(--color-ink-400)" strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={sx(data.todayIndex) + 6} y={PAD.top + 11}
              className="fill-[var(--color-ink-500)] text-[10px] font-semibold uppercase tracking-wide">
              Today
            </text>
          </g>
        )}

        {/* Underwritten is a straight-line stand-in, so it is drawn dashed —
            the dash is also the secondary encoding beside colour. */}
        <path d={line("underwritten")} fill="none" stroke={slot(0)} strokeWidth={2}
          strokeDasharray="6 4" strokeLinejoin="round" strokeLinecap="round" />
        <path d={line("scheduled")} fill="none" stroke={slot(1)} strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" />

        {hovered && at != null && (
          <g>
            <line x1={sx(at)} x2={sx(at)} y1={PAD.top} y2={PAD.top + plotH}
              stroke="var(--color-ink-300)" strokeWidth={1} />
            <circle cx={sx(at)} cy={sy(hovered.underwritten)} r={4.5} fill={slot(0)}
              stroke="var(--viz-surface)" strokeWidth={2} />
            <circle cx={sx(at)} cy={sy(hovered.scheduled)} r={4.5} fill={slot(1)}
              stroke="var(--viz-surface)" strokeWidth={2} />
          </g>
        )}
      </svg>

      <Legend
        items={[
          { label: "Underwritten (straight-line)", color: slot(0), dashed: true },
          { label: "Scheduled by project", color: slot(1) },
        ]}
      />

      {hovered && at != null && (
        <Tooltip
          hover={{
            x: (sx(at) / W) * 100,
            y: PAD.top + 12,
            title: hovered.label,
            rows: [
              { label: "Underwritten", value: exact(hovered.underwritten), color: slot(0) },
              { label: "Scheduled", value: exact(hovered.scheduled), color: slot(1) },
              { label: "Difference", value: exact(hovered.scheduled - hovered.underwritten) },
            ],
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ExecCapitalCharts({
  byPhase,
  curve,
}: {
  byPhase: CapitalByPhase;
  curve: DeploymentCurve;
}) {
  const [view, setView] = useState<"phase" | "curve">("phase");
  const unscheduled = curve.budgetTotal - curve.scheduledTotal;

  return (
    <div className="viz space-y-3">
      <style>{VIZ_CSS}</style>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-navy">
            {view === "phase" ? "Capital by phase" : "Capital deployment"}
          </h2>
          <p className="text-[12px] text-muted-foreground">
            {view === "phase"
              ? "Where the money sits today, split by cost category."
              : "Cumulative spend: the underwriting's straight line against what the project schedule actually implies."}
          </p>
        </div>
        <SegmentedControl
          options={[
            { key: "phase", label: "By phase" },
            { key: "curve", label: "Deployment" },
          ]}
          value={view}
          onChange={(next) => setView(next as "phase" | "curve")}
        />
      </div>

      {view === "phase" ? (
        <>
          <PhaseChart data={byPhase} />
          <PhaseTable data={byPhase} />
        </>
      ) : (
        <>
          <CurveChart data={curve} />
          <p className="text-[12px] text-ink-600" style={{ paddingLeft: PAD.left }}>
            Projects account for <span className="font-semibold">{exact(curve.scheduledTotal)}</span> of the{" "}
            {exact(curve.budgetTotal)} budget
            {unscheduled > 0 && (
              <>
                {" "}— <span className="font-semibold text-pending">{exact(unscheduled)}</span> is not yet
                scoped into any project, which is why the scheduled line finishes below the underwritten one
              </>
            )}
            .
            {curve.undatedCount > 0 && (
              <>
                {" "}
                {curve.undatedCount} project{curve.undatedCount === 1 ? "" : "s"} carrying{" "}
                {exact(curve.undatedAmount)} {curve.undatedCount === 1 ? "has" : "have"} no dates and{" "}
                {curve.undatedCount === 1 ? "is" : "are"} absent from the curve.
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}
