import { tierColor } from "@/lib/tier-palette";

/** A renovation-tier pill, colored by the tier's ordinal position (see tier-palette.ts). */
export function TierBadge({ label, index }: { label: string; index: number }) {
  const tc = tierColor(index);
  return (
    <span
      className="inline-block whitespace-nowrap rounded px-[9px] py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]"
      style={{ color: tc.text, backgroundColor: tc.bg, border: `1px solid ${tc.border}` }}
    >
      {label}
    </span>
  );
}
