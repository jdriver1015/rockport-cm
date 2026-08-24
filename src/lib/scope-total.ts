/**
 * What one scope line is estimated to cost.
 *
 * One definition, imported by both the scope list and the confirm dialog. They
 * had a copy each and the copies disagreed — one treated a blank quantity as 1,
 * the other as "not costed" — so the same line showed two different totals on
 * one page, and the dialog's version was what became the approved budget.
 *
 * Null means not costed, which is different from zero. A line nobody has priced
 * must not quietly contribute nothing to a total that is about to be approved;
 * it has to be visible as a gap.
 */
export function scopeLineTotal(row: {
  quantity: string | null;
  unitPrice: string | null;
}): number | null {
  if (!row.quantity || !row.unitPrice) return null;
  const q = Number(row.quantity);
  const p = Number(row.unitPrice);
  if (Number.isNaN(q) || Number.isNaN(p)) return null;
  return q * p;
}
