/**
 * DESTRUCTIVE. Deletes every property and project except Aston Post Oak.
 *
 * Ordered children-first so no foreign key is ever left dangling, and wrapped in
 * ONE transaction: a miss anywhere rolls the whole thing back rather than
 * leaving the database half-emptied.
 *
 * Three chains here are easy to miss and are handled explicitly:
 *   - scope_items.source_finding_id -> audit_findings -> site_audits
 *   - interior_unit_groups.source_batch_id -> rent_roll_batches
 *   - project_trigger_answers.condition_id -> renovation_trigger_conditions
 *
 * Reference data is left alone: charts of accounts, cost codes, vendors,
 * budget/contract templates, profiles. Those are not "properties and projects".
 *
 *   npx tsx scripts/purge-non-aston.ts           (dry run — counts only)
 *   npx tsx scripts/purge-non-aston.ts --apply   (deletes)
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { sql } from "drizzle-orm";
import { db } from "../src/db";

const KEEP_SLUG = "aston-post-oak";
const APPLY = process.argv.includes("--apply");

/** Every statement, in the order it must run. Each is scoped by the kept slug. */
const P = sql.raw(`(select id from properties where slug <> '${KEEP_SLUG}')`);
const X = sql.raw(`(select id from projects where property_id in (select id from properties where slug <> '${KEEP_SLUG}'))`);

const STEPS: { label: string; count: string; del: string }[] = [];
function step(label: string, from: string, where: string) {
  STEPS.push({
    label,
    count: `select count(*)::int as n from ${from} where ${where}`,
    del: `delete from ${from} where ${where}`,
  });
}

const DOOMED_PROPS = `(select id from properties where slug <> '${KEEP_SLUG}')`;
const DOOMED_PROJECTS = `(select id from projects where property_id in ${DOOMED_PROPS})`;
const DOOMED_BIDS = `(select id from bids where project_id in ${DOOMED_PROJECTS})`;
const DOOMED_AUDITS = `(select id from site_audits where property_id in ${DOOMED_PROPS} or project_id in ${DOOMED_PROJECTS})`;
const DOOMED_FINDINGS = `(select id from audit_findings where audit_id in ${DOOMED_AUDITS})`;
const DOOMED_STEPS = `(select id from renovation_trigger_steps where property_id in ${DOOMED_PROPS})`;
const DOOMED_GROUPS = `(select id from budget_groups where property_id in ${DOOMED_PROPS})`;
const DOOMED_UGROUPS = `(select id from interior_unit_groups where property_id in ${DOOMED_PROPS})`;
const DOOMED_BATCHES = `(select id from rent_roll_batches where property_id in ${DOOMED_PROPS})`;

step("audit_photos", "audit_photos", `finding_id in ${DOOMED_FINDINGS}`);
step("bid_line_items", "bid_line_items", `bid_id in ${DOOMED_BIDS}`);
step("bid_access_tokens", "bid_access_tokens", `bid_id in ${DOOMED_BIDS}`);
step("bid_events", "bid_events", `bid_id in ${DOOMED_BIDS}`);
step("project_contracts", "project_contracts", `project_id in ${DOOMED_PROJECTS}`);
step("bids", "bids", `project_id in ${DOOMED_PROJECTS}`);
step("project_trigger_answers", "project_trigger_answers", `project_id in ${DOOMED_PROJECTS}`);
step("scope_items", "scope_items", `project_id in ${DOOMED_PROJECTS}`);
step("audit_findings", "audit_findings", `audit_id in ${DOOMED_AUDITS}`);
step("site_audits", "site_audits", `id in ${DOOMED_AUDITS}`);
step("punch_items", "punch_items", `project_id in ${DOOMED_PROJECTS}`);
step("project_milestones", "project_milestones", `project_id in ${DOOMED_PROJECTS}`);
step("project_stage_events", "project_stage_events", `project_id in ${DOOMED_PROJECTS}`);
step("project_activity_log", "project_activity_log", `project_id in ${DOOMED_PROJECTS}`);
step("attachments", "attachments", `property_id in ${DOOMED_PROPS} or project_id in ${DOOMED_PROJECTS}`);
step("gl_transactions", "gl_transactions", `property_id in ${DOOMED_PROPS} or project_id in ${DOOMED_PROJECTS}`);
step("projects", "projects", `property_id in ${DOOMED_PROPS}`);
step("import_batches", "import_batches", `property_id in ${DOOMED_PROPS}`);
step("interior_budget_line_overrides", "interior_budget_line_overrides", `property_id in ${DOOMED_PROPS}`);
step("interior_budget_plan", "interior_budget_plan", `property_id in ${DOOMED_PROPS}`);
step("interior_unit_group_floorplans", "interior_unit_group_floorplans", `property_id in ${DOOMED_PROPS} or unit_group_id in ${DOOMED_UGROUPS}`);
step("interior_unit_groups", "interior_unit_groups", `property_id in ${DOOMED_PROPS} or source_batch_id in ${DOOMED_BATCHES}`);
step("rent_roll_units", "rent_roll_units", `property_id in ${DOOMED_PROPS} or batch_id in ${DOOMED_BATCHES}`);
step("rent_roll_batches", "rent_roll_batches", `id in ${DOOMED_BATCHES}`);
step("interior_budget_settings", "interior_budget_settings", `property_id in ${DOOMED_PROPS}`);
step("gl_property_accounts", "gl_property_accounts", `property_id in ${DOOMED_PROPS}`);
step("renovation_trigger_conditions", "renovation_trigger_conditions", `step_id in ${DOOMED_STEPS}`);
step("renovation_trigger_steps", "renovation_trigger_steps", `id in ${DOOMED_STEPS}`);
step("spec_tables", "spec_tables", `budget_group_id in ${DOOMED_GROUPS}`);
step("trade_scopes", "trade_scopes", `budget_group_id in ${DOOMED_GROUPS}`);
step("budget_group_lines", "budget_group_lines", `budget_group_id in ${DOOMED_GROUPS}`);
step("budget_groups", "budget_groups", `id in ${DOOMED_GROUPS}`);
step("budget_lines", "budget_lines", `property_id in ${DOOMED_PROPS}`);
step("units", "units", `property_id in ${DOOMED_PROPS}`);
step("properties", "properties", `id in ${DOOMED_PROPS}`);

async function main() {
  void P; void X;
  const keep = (await db().execute(sql.raw(
    `select id, name from properties where slug = '${KEEP_SLUG}'`))) as unknown as { id: number; name: string }[];
  if (keep.length !== 1) throw new Error(`expected exactly one '${KEEP_SLUG}' property, found ${keep.length}`);
  console.log(`Keeping #${keep[0].id} ${keep[0].name} and everything under it.\n`);

  let total = 0;
  for (const s of STEPS) {
    const [{ n }] = (await db().execute(sql.raw(s.count))) as unknown as { n: number }[];
    total += n;
    if (n > 0) console.log(`  ${s.label.padEnd(32)} ${String(n).padStart(6)}`);
  }
  console.log(`\n  ${"TOTAL ROWS".padEnd(32)} ${String(total).padStart(6)}`);

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to delete.");
    return;
  }

  await db().transaction(async (tx) => {
    for (const s of STEPS) await tx.execute(sql.raw(s.del));
  });
  console.log("\nApplied — all statements committed together.");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
