/**
 * The template a fresh install starts with.
 *
 * Deliberately short and deliberately generic. It is a working skeleton so the
 * feature does something on day one, not legal advice — the placeholders and the
 * structure are the point, and the words are meant to be replaced with whatever
 * counsel actually approves.
 */
export const STARTER_TEMPLATE = `This Work Order is entered into between {{company}} ("Owner") and {{vendor}} ("Contractor") for work at {{property}}, {{project}}.

1. SCOPE OF WORK
Contractor shall furnish all labor, materials, equipment and supervision necessary to complete the work described in Exhibit A, attached and incorporated by reference.

2. CONTRACT PRICE
Owner shall pay Contractor {{amount}} for the work described in Exhibit A. This is the full and complete price. No additional amount is owed for any work within that scope.

3. CHANGES
No change to the scope or the price is binding unless agreed in writing and signed by both parties before the changed work begins. Work performed outside Exhibit A without prior written authorization is at Contractor's own cost.

4. SCHEDULE
Contractor shall begin promptly on notice to proceed and complete the work with reasonable diligence. Contractor shall notify Owner immediately of anything that will delay completion.

5. PAYMENT
Owner shall pay within thirty (30) days of receipt of an invoice for work completed and accepted. Owner may withhold payment for work that does not conform to Exhibit A until it is corrected.

6. INSURANCE
Contractor shall maintain general liability and workers' compensation coverage in amounts required by law and shall provide certificates on request. Coverage shall remain in force for the duration of the work.

7. INDEPENDENT CONTRACTOR
Contractor is an independent contractor. Nothing here creates an employment, partnership or joint venture relationship, and Contractor is responsible for its own personnel, taxes and withholding.

8. WARRANTY
Contractor warrants the work against defects in materials and workmanship for one (1) year from completion and shall correct defective work at its own cost.

9. TERMINATION
Owner may terminate this Work Order on written notice. Contractor shall be paid for work properly completed through the date of termination and for nothing else.`;

/** The placeholders the generator fills. Shown in the settings editor. */
export const TEMPLATE_PLACEHOLDERS = [
  { token: "{{company}}", describes: "Your company name" },
  { token: "{{vendor}}", describes: "The awarded vendor" },
  { token: "{{property}}", describes: "The property" },
  { token: "{{project}}", describes: "The project or unit" },
  { token: "{{amount}}", describes: "The contract price" },
  { token: "{{date}}", describes: "Today's date" },
] as const;

export type TemplateFields = {
  company: string;
  vendor: string;
  property: string;
  project: string;
  amount: string;
  date: string;
};

/**
 * Fill the placeholders.
 *
 * Unknown tokens are left alone rather than blanked: a template that says
 * {{retainage}} should show that word in the draft so somebody notices it is
 * not supported, instead of silently producing a sentence with a hole in it.
 */
export function fillTemplate(body: string, fields: TemplateFields): string {
  return body.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    key in fields ? fields[key as keyof TemplateFields] : whole,
  );
}
