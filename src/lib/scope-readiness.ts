import { scopeLineTotal } from "@/lib/scope-total";

/**
 * Whether a scope is ready to go out — the one definition the server enforces
 * when it confirms a scope (scopeConfirmBlocker) and the Scope & Bids dialog
 * shows before anybody presses Send. Pure, so both sides import the same rules
 * rather than keeping copies that drift: the dialog's copy used to miss the
 * blank-name rule and test "priced" differently from the server.
 *
 * Every line needs a name and a price — a vendor cannot quote a line with no
 * price, and the sum is what gets committed against. Common-area lines also need
 * a description, because vendors price from what is written; a unit turn's
 * lines come from a budget template where the item IS the specification.
 */
export type ReadinessLine = {
  item: string | null;
  description: string | null;
  quantity: string | null;
  unitPrice: string | null;
};

export type ScopeReadiness = {
  unpricedCount: number;
  missingDescription: number;
  /** Why the scope cannot go out yet, naming the lines, or null when it can. */
  blocker: string | null;
};

export function scopeReadiness(
  lines: readonly ReadinessLine[],
  requireDescriptions: boolean,
): ScopeReadiness {
  const unpriced = lines.filter((l) => scopeLineTotal(l) == null);
  const unnamed = lines.filter((l) => !l.item?.trim());
  const undescribed = requireDescriptions ? lines.filter((l) => !l.description?.trim()) : [];

  // Named individually rather than counted: "3 lines need a description" sends
  // you hunting, and the whole reason to confirm is that somebody read them.
  const blocker =
    lines.length === 0
      ? "There is no scope to confirm"
      : unpriced.length > 0
        ? `${describeLines(unpriced.length)} a price: ${names(unpriced)}`
        : unnamed.length > 0
          ? `${describeLines(unnamed.length)} a name`
          : undescribed.length > 0
            ? `${describeLines(undescribed.length)} a description: ${names(undescribed)}`
            : null;

  return { unpricedCount: unpriced.length, missingDescription: undescribed.length, blocker };
}

/** "1 scope line still needs" / "3 scope lines still need". */
function describeLines(n: number): string {
  return n === 1 ? "1 scope line still needs" : `${n} scope lines still need`;
}

function names(lines: readonly ReadinessLine[]): string {
  const shown = lines.map((l) => (l.item ?? "").trim()).slice(0, 3).join(", ");
  return lines.length > 3 ? `${shown} and ${lines.length - 3} more` : shown;
}
