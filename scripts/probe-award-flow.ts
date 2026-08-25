/**
 * End-to-end probe of the award flow, against the real database.
 *
 * The paths this covers cannot be unit tested — they are several writes across
 * bids, scope items, projects and contracts, and the bugs they had were bugs of
 * interaction: a stale project vendor after a second award, and a unique index
 * that refused the second contract a split award needs. Both survived typecheck,
 * lint and 28 pure assertions.
 *
 * Creates its own project, exercises the flow, asserts, and DELETES everything
 * it made in a finally block. It touches no existing row. Safe to re-run.
 *
 *   npx tsx scripts/probe-award-flow.ts
 *
 * Exits non-zero if any assertion fails.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../src/db";
import { confirmScopeRows, directAwardRows } from "../src/lib/scope-confirm";
import { generateContractRow, advanceContractRow, readContracts } from "../src/lib/contracts";
import { readPreconGateState } from "../src/lib/precon-gate-state";
import { evaluateGates } from "../src/lib/phase-gates";
import { readAwardCoverage } from "../src/lib/award-coverage";

const PROPERTY_ID = 1;
const CODE_A = 1; // 1000-0001 Exterior Paint and Carpentry
const CODE_B = 2; // 1000-0002 Carpentry Repairs
const VENDOR_A = 2; // Ace
const VENDOR_B = 1; // ZZ Test Fencing Co

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}${detail ? `  — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

async function main() {
  let projectId = 0;

  try {
    // ---------------------------------------------------------------- setup
    const [project] = await db()
      .insert(schema.projects)
      .values({
        propertyId: PROPERTY_ID,
        kind: "common",
        name: "ZZ probe — split award",
        phase: "precon",
        budgetAmount: "0",
      })
      .returning({ id: schema.projects.id });
    projectId = project.id;
    console.log(`probe project #${projectId}\n`);

    const lines = await db()
      .insert(schema.scopeItems)
      .values([
        { projectId, item: "Probe line A", costCodeId: CODE_A, quantity: "1", unitPrice: "60000", sortOrder: 1 },
        { projectId, item: "Probe line B", costCodeId: CODE_B, quantity: "1", unitPrice: "40000", sortOrder: 2 },
      ])
      .returning({ id: schema.scopeItems.id });
    const [lineA, lineB] = lines.map((l) => l.id);

    // ------------------------------------------------- confirm preconditions
    console.log("confirm preconditions");
    let r = await confirmScopeRows(projectId);
    check("refuses with no budget", !r.ok, r.ok ? "" : r.error);

    await db()
      .update(schema.projects)
      .set({ budgetAmount: "100000" })
      .where(eq(schema.projects.id, projectId));

    r = await confirmScopeRows(projectId);
    check("refuses with no description", !r.ok, r.ok ? "" : r.error);
    check(
      "the refusal names the lines",
      !r.ok && r.error.includes("Probe line A"),
      r.ok ? "" : r.error,
    );

    await db()
      .update(schema.scopeItems)
      .set({ materialQuality: "Probe description." })
      .where(inArray(schema.scopeItems.id, [lineA, lineB]));

    r = await confirmScopeRows(projectId);
    check("confirms once budget and descriptions exist", r.ok, r.ok ? "" : r.error);

    const confirmed = await db().query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
      columns: { scopeConfirmedAt: true },
    });
    check("scope_confirmed_at is stamped", confirmed?.scopeConfirmedAt != null);

    // ------------------------------------------------------- disjoint awards
    console.log("\ndisjoint awards");
    const a1 = await directAwardRows(projectId, VENDOR_A, "60000", "probe", [lineA]);
    check("awards vendor A on line A", a1.ok, a1.ok ? `bid ${a1.bidId}` : a1.error);

    const a2 = await directAwardRows(projectId, VENDOR_B, "40000", "probe", [lineB]);
    check("awards vendor B on line B — disjoint, allowed", a2.ok, a2.ok ? `bid ${a2.bidId}` : a2.error);

    const clash = await directAwardRows(projectId, VENDOR_A, "1000", "probe", [lineA]);
    check("refuses an overlapping award", !clash.ok, clash.ok ? "" : clash.error);

    // ------------------------------------------------------------- coverage
    const coverage = await readAwardCoverage(projectId);
    check("coverage holds both lines", coverage.size === 2, `size ${coverage.size}`);
    check(
      "line A is held by vendor A",
      coverage.get(lineA)?.vendorId === VENDOR_A,
      `vendor ${coverage.get(lineA)?.vendorId}`,
    );

    // ---------------------------------------------------- vendor propagation
    console.log("\nvendor propagation and committed cost");
    const scoped = await db()
      .select({ id: schema.scopeItems.id, vendorId: schema.scopeItems.vendorId })
      .from(schema.scopeItems)
      .where(eq(schema.scopeItems.projectId, projectId));
    check(
      "line A carries vendor A",
      scoped.find((s) => s.id === lineA)?.vendorId === VENDOR_A,
      `got ${scoped.find((s) => s.id === lineA)?.vendorId}`,
    );
    check(
      "line B carries vendor B",
      scoped.find((s) => s.id === lineB)?.vendorId === VENDOR_B,
      `got ${scoped.find((s) => s.id === lineB)?.vendorId}`,
    );

    const afterAward = await db().query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
      columns: { committedCost: true, vendorId: true },
    });
    check(
      "committed cost sums both awards",
      Number(afterAward?.committedCost) === 100000,
      `${afterAward?.committedCost}`,
    );
    check(
      "project vendor left alone with two awarded vendors",
      afterAward?.vendorId == null,
      `${afterAward?.vendorId}`,
    );

    // ------------------------------------------------------------ bid gate
    console.log("\ngates");
    let state = await readPreconGateState(projectId);
    let gate = evaluateGates("precon", "in_process", {
      ...state,
      hasStartMilestoneActual: false,
      openFindingCount: 0,
      postedGlTotal: 0,
    });
    const bidCheck = gate.checks.find((c) => c.key === "bid")!;
    check("bid gate met by full coverage", bidCheck.met, bidCheck.detail);
    check("bid gate names both vendors", bidCheck.detail === "2 vendors awarded", bidCheck.detail);

    // ------------------------------------------------------------ contracts
    console.log("\ncontracts, one per award");
    const bidAId = a1.ok ? a1.bidId : 0;
    const bidBId = a2.ok ? a2.bidId : 0;

    const c1 = await generateContractRow(bidAId);
    check("generates a contract for award A", c1.ok, c1.ok ? `contract ${c1.contractId}` : c1.error);

    const c2 = await generateContractRow(bidBId);
    check("generates a SECOND contract for award B", c2.ok, c2.ok ? `contract ${c2.contractId}` : c2.error);

    if (c1.ok) await advanceContractRow(projectId, c1.contractId, "executed");
    let proj = await db().query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
      columns: { contractSignedAt: true },
    });
    check(
      "contract_signed_at stays null with one of two executed",
      proj?.contractSignedAt == null,
      `${proj?.contractSignedAt}`,
    );

    state = await readPreconGateState(projectId);
    gate = evaluateGates("precon", "in_process", {
      ...state,
      hasStartMilestoneActual: false,
      openFindingCount: 0,
      postedGlTotal: 0,
    });
    let contractCheck = gate.checks.find((c) => c.key === "contract")!;
    check("contract gate not met yet", !contractCheck.met, contractCheck.detail);

    if (c2.ok) await advanceContractRow(projectId, c2.contractId, "executed");
    proj = await db().query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
      columns: { contractSignedAt: true },
    });
    check("contract_signed_at set once BOTH are executed", proj?.contractSignedAt != null, `${proj?.contractSignedAt}`);

    state = await readPreconGateState(projectId);
    gate = evaluateGates("precon", "in_process", {
      ...state,
      hasStartMilestoneActual: false,
      openFindingCount: 0,
      postedGlTotal: 0,
    });
    contractCheck = gate.checks.find((c) => c.key === "contract")!;
    check("contract gate met", contractCheck.met, contractCheck.detail);

    const live = await readContracts(projectId);
    check("both contracts read back", live.length === 2, `${live.length}`);

    // ------------------------------------------------------ voiding re-opens
    console.log("\nvoiding one contract re-opens the gate");
    if (c2.ok) await advanceContractRow(projectId, c2.contractId, "voided");
    proj = await db().query.projects.findFirst({
      where: eq(schema.projects.id, projectId),
      columns: { contractSignedAt: true },
    });
    check("contract_signed_at cleared", proj?.contractSignedAt == null, `${proj?.contractSignedAt}`);
  } finally {
    // ------------------------------------------------------------- teardown
    if (projectId) {
      const bids = await db()
        .select({ id: schema.bids.id })
        .from(schema.bids)
        .where(eq(schema.bids.projectId, projectId));
      const bidIds = bids.map((b) => b.id);

      await db()
        .delete(schema.projectContracts)
        .where(eq(schema.projectContracts.projectId, projectId));
      if (bidIds.length)
        await db().delete(schema.bidLineItems).where(inArray(schema.bidLineItems.bidId, bidIds));
      await db().delete(schema.bids).where(eq(schema.bids.projectId, projectId));
      await db().delete(schema.scopeItems).where(eq(schema.scopeItems.projectId, projectId));
      await db()
        .delete(schema.projectActivityLog)
        .where(eq(schema.projectActivityLog.projectId, projectId));
      await db()
        .delete(schema.projectStageEvents)
        .where(eq(schema.projectStageEvents.projectId, projectId));
      await db().delete(schema.projects).where(eq(schema.projects.id, projectId));

      const gone = await db().query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
      console.log(`\nteardown: probe project #${projectId} ${gone ? "STILL PRESENT" : "removed"}`);
    }
    console.log(`\n${pass} passed, ${fail} failed`);
  }
}

main()
  .then(() => process.exit(fail > 0 ? 1 : 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
