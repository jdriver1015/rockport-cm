/**
 * Hand-rolled SVG chart primitives for the executive dashboard.
 *
 * No charting library: an S-curve and a moving average are both a polyline
 * with axes, and this codebase carries no chart dependency today. These take
 * their colours from the brand tokens so a chart reads as part of the app
 * rather than as an embedded widget.
 *
 * Everything is drawn in a fixed viewBox and scaled by the browser, so the
 * charts are responsive without measuring anything on the client — which also
 * keeps them renderable from a Server Component.
 */

export type Point = { x: number; y: number };

export type Series = {
  key: string;
  label: string;
  /** Any CSS colour — brand tokens are passed as `var(--color-navy)`. */
  color: string;
  points: Point[];
  /** Future/projected portions are drawn dashed. */
  dashed?: boolean;
  /** Soft fill under the line, for the one series that carries the headline. */
  fill?: boolean;
};

const W = 900;
const PAD = { top: 16, right: 20, bottom: 34, left: 64 };

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / mag) * mag;
}

export function LineChart({
  series,
  xLabels,
  yFormat,
  height = 260,
  markerX,
  markerLabel,
  yMax: yMaxIn,
}: {
  series: Series[];
  /** One label per x index; sparse labels are fine — pass "" to skip. */
  xLabels: string[];
  yFormat: (v: number) => string;
  height?: number;
  /** Draws a vertical rule, used for "today". */
  markerX?: number;
  markerLabel?: string;
  yMax?: number;
}) {
  const H = height;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const lastX = Math.max(1, xLabels.length - 1);
  const yMax = yMaxIn ?? niceCeil(Math.max(...series.flatMap((s) => s.points.map((p) => p.y)), 1));

  const sx = (x: number) => PAD.left + (x / lastX) * plotW;
  const sy = (y: number) => PAD.top + plotH - (y / yMax) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" preserveAspectRatio="xMidYMid meet">
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)}
              stroke="var(--color-hairline)" strokeWidth={1}
            />
            <text
              x={PAD.left - 10} y={sy(t) + 4} textAnchor="end"
              className="fill-[var(--color-ink-400)] text-[11px] tabular-nums"
            >
              {yFormat(t)}
            </text>
          </g>
        ))}

        {xLabels.map((label, i) =>
          label ? (
            <text
              key={i} x={sx(i)} y={H - 12} textAnchor="middle"
              className="fill-[var(--color-ink-400)] text-[11px]"
            >
              {label}
            </text>
          ) : null,
        )}

        {markerX != null && (
          <g>
            <line
              x1={sx(markerX)} x2={sx(markerX)} y1={PAD.top} y2={PAD.top + plotH}
              stroke="var(--color-alert)" strokeWidth={1.5} strokeDasharray="4 3"
            />
            {markerLabel && (
              <text
                x={sx(markerX) + 6} y={PAD.top + 11}
                className="fill-[var(--color-alert)] text-[10px] font-semibold uppercase tracking-wide"
              >
                {markerLabel}
              </text>
            )}
          </g>
        )}

        {series.map((s) => {
          if (s.points.length === 0) return null;
          const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x)},${sy(p.y)}`).join(" ");
          const area =
            `M${sx(s.points[0].x)},${sy(0)} ` +
            s.points.map((p) => `L${sx(p.x)},${sy(p.y)}`).join(" ") +
            ` L${sx(s.points[s.points.length - 1].x)},${sy(0)} Z`;
          return (
            <g key={s.key}>
              {s.fill && <path d={area} fill={s.color} opacity={0.08} />}
              <path
                d={d} fill="none" stroke={s.color} strokeWidth={2.25}
                strokeLinejoin="round" strokeLinecap="round"
                strokeDasharray={s.dashed ? "6 4" : undefined}
              />
            </g>
          );
        })}
      </svg>
      <Legend series={series} />
    </div>
  );
}

export function BarChart({
  bars,
  xLabels,
  yFormat,
  height = 220,
  targetLine,
  targetLabel,
  barColor = "var(--color-navy)",
}: {
  bars: number[];
  xLabels: string[];
  yFormat: (v: number) => string;
  height?: number;
  /** A required run-rate, drawn across the bars. */
  targetLine?: number;
  targetLabel?: string;
  barColor?: string;
}) {
  const H = height;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const yMax = niceCeil(Math.max(...bars, targetLine ?? 0, 1));
  const sy = (y: number) => PAD.top + plotH - (y / yMax) * plotH;
  const slot = plotW / bars.length;
  const barW = Math.min(30, slot * 0.6);
  const ticks = [0, 0.5, 1].map((t) => t * yMax);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" preserveAspectRatio="xMidYMid meet">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} stroke="var(--color-hairline)" strokeWidth={1} />
            <text x={PAD.left - 10} y={sy(t) + 4} textAnchor="end" className="fill-[var(--color-ink-400)] text-[11px] tabular-nums">
              {yFormat(t)}
            </text>
          </g>
        ))}

        {bars.map((v, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          return (
            <g key={i}>
              <rect
                x={cx - barW / 2} y={sy(v)} width={barW} height={Math.max(1, PAD.top + plotH - sy(v))}
                fill={barColor} rx={2} opacity={0.85}
              />
              <text x={cx} y={H - 12} textAnchor="middle" className="fill-[var(--color-ink-400)] text-[11px]">
                {xLabels[i]}
              </text>
            </g>
          );
        })}

        {targetLine != null && (
          <g>
            <line
              x1={PAD.left} x2={W - PAD.right} y1={sy(targetLine)} y2={sy(targetLine)}
              stroke="var(--color-alert)" strokeWidth={2} strokeDasharray="6 4"
            />
            {targetLabel && (
              <text
                x={W - PAD.right} y={sy(targetLine) - 7} textAnchor="end"
                className="fill-[var(--color-alert)] text-[11px] font-semibold"
              >
                {targetLabel}
              </text>
            )}
          </g>
        )}
      </svg>
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1.5 pl-[64px]">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5 text-[11.5px] text-ink-600">
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
