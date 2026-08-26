/**
 * What changes if a project's budget stops being typed and starts being the sum
 * of its scope lines — and which projects the budget page currently files under
 * the wrong cost code.
 *
 * Read-only. Writes nothing.
 *
 *   npx tsx scripts/report-project-budget-derivation.ts
 *
 * PART A — projects.budget_amount is entered by hand today (the inline editor,
 * the Confirm Scope dialog, Manage > Edit) while the scope lines carry their own
 * quantity x unit price. Nothing keeps the two in step, so this lists every
 * project where deriving the budget would move the number, and by how much.
 * Those figures are read by the property page, the budget page and the
 * interiors page, so a move here is visible in three other places.
 *
 * PART B — projects.cost_code_id assigns ONE underwriting line to a project
 * whose scope may span several. src/app/properties/[slug]/budget/page.tsx files
 * the project's whole budget under that single code. This lists the projects
 * where that is already wrong.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { eq, isNull } from "drizzle-orm";
import { db, schema } from "../src/db";

const usd = (n: number) =>
  n < 0 ? `(${Math.abs(Math.round(n)).toLocaleString()})` : Math.round(n).toLocaleString();

async function main() {
  const projects = await db()
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      kind: schema.projects.kind,
      property: schema.properties.name,
      budgetAmount: schema.projects.budgetAmount,
      costCodeId: schema.projects.costCodeId,
      codeName: schema.costCodes.name,
    })
    .from(schema.projects)
    .innerJoin(schema.properties, eq(schema.properties.id, schema.projects.propertyId))
    .leftJoin(schema.costCodes, eq(schema.costCodes.id, schema.projects.costCodeId))
    .where(isNull(schema.projects.archivedAt));

  const lines = await db()
    .select({
      projectId: schema.scopeItems.projectId,
      costCodeId: schema.scopeItems.costCodeId,
      codeName: schema.costCodes.name,
      quantity: schema.scopeItems.quantity,
      unitPrice: schema.scopeItems.unitPrice,
    })
    .from(schema.scopeItems)
    .leftJoin(schema.costCodes, eq(schema.costCodes.id, schema.scopeItems.costCodeId))
    .where(isNull(schema.scopeItems.archivedAt));

  const byProject = new Map<number, typeof lines>();
  for (const l of lines) {
    const list = byProject.get(l.projectId) ?? [];
    list.push(l);
    byProject.set(l.projectId, list);
  }

  // ------------------------------------------------------------------ part A
  console.log("PART A — deriving budget from scope lines\n");
  console.log(
    "  " +
      "project".padEnd(34) +
      "typed".padStart(12) +
      "scope sum".padStart(12) +
      "delta".padStart(12) +
      "  unpriced",
  );
  console.log("  " + "-".repeat(84));

  let moved = 0;
  let unchanged = 0;
  let biggest = { name: "", delta: 0 };

  const rows = projects
    .map((p) => {
      const mine = byProject.get(p.id) ?? [];
      const priced = mine.filter((l) => l.quantity && l.unitPrice);
      const sum = priced.reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice), 0);
      const typed = Number(p.budgetAmount ?? 0);
      return { p, typed, sum, delta: sum - typed, unpriced: mine.length - priced.length, lines: mine.length };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  for (const r of rows) {
    if (Math.abs(r.delta) < 1) {
      unchanged++;
      continue;
    }
    moved++;
    if (Math.abs(r.delta) > Math.abs(biggest.delta)) {
      biggest = { name: `${r.p.name} #${r.p.id}`, delta: r.delta };
    }
    const flag = r.unpriced > 0 ? `  ${r.unpriced} of ${r.lines}` : "";
    console.log(
      "  " +
        `${r.p.name} #${r.p.id}`.slice(0, 33).padEnd(34) +
        usd(r.typed).padStart(12) +
        usd(r.sum).padStart(12) +
        usd(r.delta).padStart(12) +
        flag,
    );
  }

  console.log(
    `\n  ${moved} project(s) would move, ${unchanged} unchanged.` +
      (biggest.name ? `  Largest: ${biggest.name} ${usd(biggest.delta)}.` : ""),
  );

  const zeroScope = rows.filter((r) => r.lines === 0 && r.typed > 0);
  if (zeroScope.length) {
    console.log(
      `\n  ${zeroScope.length} project(s) have a typed budget and NO scope lines — deriving would zero them:`,
    );
    for (const r of zeroScope) console.log(`    ${r.p.name} #${r.p.id} — ${usd(r.typed)} would become 0`);
  }

  const anyUnpriced = rows.filter((r) => r.unpriced > 0);
  console.log(
    `\n  ${anyUnpriced.length} project(s) have unpriced lines — those would block "confirm scope"` +
      " once the precondition becomes every-line-priced.",
  );

  // ------------------------------------------------------------------ part B
  console.log("\n\nPART B — projects whose scope spans more than one budget category\n");
  console.log("  the budget page files the whole project budget under projects.cost_code_id\n");

  let spanning = 0;
  for (const p of projects) {
    const mine = byProject.get(p.id) ?? [];
    const codes = [...new Set(mine.map((l) => l.codeName).filter((c): c is string => c != null))];
    if (codes.length <= 1) continue;
    spanning++;
    const sum = mine
      .filter((l) => l.quantity && l.unitPrice)
      .reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice), 0);
    console.log(`  ${p.name} #${p.id} — ${usd(sum)} filed under "${p.codeName ?? "no code"}"`);
    console.log(`      scope actually spans: ${codes.join(", ")}`);
  }
  console.log(
    spanning === 0
      ? "  none — every project's scope sits on one category"
      : `\n  ${spanning} project(s) are mis-attributed on the property budget page today.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
