/**
 * End-to-end probe of the merged Scope & Bids step, against the real database.
 *
 * Confirming the scope stopped being its own button: sending the scope out,
 * awarding it directly, and awarding a hand-recorded bid each confirm it in the
 * same write. The assertions that matter are the refusals — a scope that could
 * not be confirmed by hand must not be confirmed by sending it either, and a
 * refused send must leave the scope exactly as unconfirmed as it found it.
 *
 * Creates its own projects, asserts, and DELETES everything it made in a
 * finally block. It touches no existing row. Safe to re-run.
 *
 *   npx tsx scripts/probe-scope-bids.ts
 *
 * Exits non-zero if any assertion fails.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { eq, inArray, like } from "drizzle-orm";
import { db, schema } from "../src/db";
import { sendBidPackageRows } from "../src/lib/bid-package";
import { directAwardRows, unconfirmScopeRows } from "../src/lib/scope-confirm";
import { addBid, clearBidWinner, setBidWinner } from "../src/lib/actions/bids";
import { advanceContractRow, generateContractRow } from "../src/lib/contracts";
import { readPreconGateState } from "../src/lib/precon-gate-state";
import { evaluateGates } from "../src/lib/phase-gates";
import { loadFixtures } from "./probe-fixtures";

const NAME = "ZZ probe — scope & bids";

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

/**
 * Run an action whose own work is done before it revalidates. revalidatePath
 * needs a request around it, so outside Next it throws after the writes have
 * committed — that throw is not a failure of what is being probed.
 */
async function outsideNext<T>(fn: () => Promise<T>): Promise<T | "revalidated"> {
  try {
    return await fn();
  } catch (err) {
    const message = String(err);
    if (message.includes("static generation store") || message.includes("Server Action")) {
      return "revalidated";
    }
    throw err;
  }
}

async function confirmedAt(projectId: number) {
  const row = await db().query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: { scopeConfirmedAt: true },
  });
  return row?.scopeConfirmedAt ?? null;
}

async function scopeBidsGate(projectId: number) {
  const state = await readPreconGateState(projectId);
  const gate = evaluateGates("precon", "in_process", state);
  return gate.checks.find((c) => c.key === "scope_bids")!;
}

async function makeProject(suffix: string, codeId: number, priced: boolean) {
  const [project] = await db()
    .insert(schema.projects)
    .values({ propertyId: PROPERTY_ID, kind: "common", name: `${NAME} ${suffix}`, phase: "precon" })
    .returning({ id: schema.projects.id });
  const [line] = await db()
    .insert(schema.scopeItems)
    .values({
      projectId: project.id,
      item: "Probe line",
      materialQuality: "Probe description.",
      costCodeId: codeId,
      quantity: priced ? "1" : null,
      unitPrice: priced ? "25000" : null,
      sortOrder: 1,
    })
    .returning({ id: schema.scopeItems.id });
  return { projectId: project.id, lineId: line.id };
}

let PROPERTY_ID = 0;

async function main() {
  const fx = await loadFixtures();
  PROPERTY_ID = fx.propertyId;
  console.log(`  fixtures: property ${fx.propertySlug}, vendors ${fx.vendorA}/${fx.vendorB}\n`);

  try {
    // --------------------------------------------------------- send refused
    console.log("sending an unpriced scope");
    const unpriced = await makeProject("unpriced", fx.codeA, false);
    const refused = await sendBidPackageRows(unpriced.projectId, [fx.vendorA], [unpriced.lineId]);
    check("is refused", !refused.ok, refused.ok ? "sent" : refused.error);
    check(
      "and says what is missing",
      !refused.ok && refused.error === "1 scope line still needs a price: Probe line",
      refused.ok ? "" : refused.error,
    );
    check("leaves the scope unconfirmed", (await confirmedAt(unpriced.projectId)) == null);
    const bidsAfterRefusal = await db()
      .select({ id: schema.bids.id })
      .from(schema.bids)
      .where(eq(schema.bids.projectId, unpriced.projectId));
    check("creates no request", bidsAfterRefusal.length === 0, `${bidsAfterRefusal.length}`);

    // ------------------------------------------------------- send confirms
    console.log("\nsending a ready scope");
    const ready = await makeProject("send", fx.codeA, true);
    let gate = await scopeBidsGate(ready.projectId);
    check("the gate asks for it to be sent", gate.short === "Send for pricing", gate.short);

    const sent = await sendBidPackageRows(ready.projectId, [fx.vendorA, fx.vendorB], [ready.lineId]);
    check("goes out", sent.ok && sent.sent === 2, sent.ok ? `${sent.sent} sent` : sent.error);
    const stamped = await confirmedAt(ready.projectId);
    check("confirms the scope in the same write", stamped != null, `${stamped?.toISOString()}`);

    gate = await scopeBidsGate(ready.projectId);
    check("the gate now waits on the vendors", gate.detail === "2 out for bid", gate.detail);

    // A second send must not move the confirmation date — it records when the
    // scope was agreed, not when it was last sent.
    await sendBidPackageRows(ready.projectId, [fx.vendorA], [ready.lineId]);
    const again = await confirmedAt(ready.projectId);
    check(
      "a later send keeps the original confirmation date",
      again?.getTime() === stamped?.getTime(),
      `${again?.toISOString()}`,
    );

    // --------------------------------------------------- one bid comes back
    if (sent.ok) {
      await db()
        .update(schema.bids)
        .set({ status: "received", receivedDate: "2026-10-01" })
        .where(eq(schema.bids.id, sent.created[0].bidId));
      gate = await scopeBidsGate(ready.projectId);
      check("counts what has come back", gate.detail === "1 of 2 back", gate.detail);
      check("and asks for a pick", gate.short === "Select bid", gate.short);
    }

    // --------------------------------------------------- direct award path
    console.log("\nawarding directly");
    const direct = await makeProject("direct", fx.codeA, true);
    const awarded = await directAwardRows(direct.projectId, fx.vendorA, "25000", "probe");
    check("awards", awarded.ok, awarded.ok ? `bid ${awarded.bidId}` : awarded.error);
    check("confirms the scope", (await confirmedAt(direct.projectId)) != null);
    gate = await scopeBidsGate(direct.projectId);
    check("meets the gate with no RFP ever sent", gate.met, gate.detail);

    const directUnpriced = await makeProject("direct unpriced", fx.codeA, false);
    const directRefused = await directAwardRows(directUnpriced.projectId, fx.vendorA, "25000", "probe");
    check("refuses an unpriced scope", !directRefused.ok, directRefused.ok ? "awarded" : directRefused.error);
    check("and leaves it unconfirmed", (await confirmedAt(directUnpriced.projectId)) == null);

    // ------------------------------------------------- hand-recorded award
    console.log("\nawarding a hand-recorded bid");
    const manual = await makeProject("manual", fx.codeA, true);
    await outsideNext(() =>
      addBid({
        propertyId: PROPERTY_ID,
        projectId: manual.projectId,
        vendorId: fx.vendorB,
        lines: [{ scopeItemId: manual.lineId, description: "Probe line", amount: 24000 }],
      }),
    );
    const manualBid = await db().query.bids.findFirst({
      where: eq(schema.bids.projectId, manual.projectId),
      columns: { id: true },
    });
    check("records the bid without confirming anything", (await confirmedAt(manual.projectId)) == null);
    if (manualBid) {
      const res = await outsideNext(() =>
        setBidWinner({ id: manualBid.id, propertyId: PROPERTY_ID, projectId: manual.projectId }),
      );
      check(
        "the award goes through",
        res === "revalidated" || res.ok,
        res === "revalidated" ? "written" : res.ok ? "ok" : res.error,
      );
      check("and confirms the scope", (await confirmedAt(manual.projectId)) != null);
    } else {
      check("the hand-recorded bid exists", false);
    }

    // ----------------------------------------------------- moving an award
    console.log("\nmoving an award between vendors");
    const moving = await makeProject("move", fx.codeA, true);
    for (const [vendorId, amount] of [
      [fx.vendorA, 25000],
      [fx.vendorB, 23000],
    ] as const) {
      await outsideNext(() =>
        addBid({
          propertyId: PROPERTY_ID,
          projectId: moving.projectId,
          vendorId,
          lines: [{ scopeItemId: moving.lineId, description: "Probe line", amount }],
        }),
      );
    }
    const [bidA, bidB] = await db()
      .select({ id: schema.bids.id, vendorId: schema.bids.vendorId })
      .from(schema.bids)
      .where(eq(schema.bids.projectId, moving.projectId))
      .orderBy(schema.bids.bidNumber);
    const approvedOf = async (id: number) =>
      (await db().query.bids.findFirst({ where: eq(schema.bids.id, id), columns: { approved: true } }))
        ?.approved ?? false;
    const ctx = { propertyId: PROPERTY_ID, projectId: moving.projectId };

    gate = await scopeBidsGate(moving.projectId);
    check(
      "two hand-recorded bids read as something to pick",
      gate.short === "Select bid" && gate.detail === "2 of 2 back",
      `${gate.short} · ${gate.detail}`,
    );

    await outsideNext(() => setBidWinner({ id: bidA.id, ...ctx }));
    check("vendor A holds the line", await approvedOf(bidA.id));

    const reopen = await unconfirmScopeRows(moving.projectId);
    check(
      "the awarded scope cannot be re-opened",
      !reopen.ok,
      reopen.ok ? "re-opened" : reopen.error,
    );
    check("and stays confirmed", (await confirmedAt(moving.projectId)) != null);

    const plain = await outsideNext(() => setBidWinner({ id: bidB.id, ...ctx }));
    check(
      "a plain award to B is refused for the overlap",
      plain !== "revalidated" && !plain.ok,
      plain === "revalidated" ? "awarded" : plain.ok ? "awarded" : plain.error,
    );

    const contract = await generateContractRow(bidA.id);
    check("A's award gets a contract", contract.ok, contract.ok ? `#${contract.contractId}` : contract.error);

    const blockedMove = await outsideNext(() =>
      setBidWinner({ id: bidB.id, ...ctx, replaceOverlapping: true }),
    );
    check(
      "moving it to B is refused while A has a contract",
      blockedMove !== "revalidated" && !blockedMove.ok && blockedMove.error.includes("contract"),
      blockedMove === "revalidated" ? "moved" : blockedMove.ok ? "moved" : blockedMove.error,
    );
    check("and A still holds it", (await approvedOf(bidA.id)) && !(await approvedOf(bidB.id)));

    const blockedTakeBack = await outsideNext(() => clearBidWinner({ id: bidA.id, ...ctx }));
    check(
      "taking it back is refused too",
      blockedTakeBack !== "revalidated" && !blockedTakeBack.ok,
      blockedTakeBack === "revalidated" ? "taken back" : blockedTakeBack.ok ? "taken back" : blockedTakeBack.error,
    );

    if (contract.ok) await advanceContractRow(moving.projectId, contract.contractId, "voided");
    await outsideNext(() => setBidWinner({ id: bidB.id, ...ctx, replaceOverlapping: true }));
    check(
      "once voided, the award moves to B",
      !(await approvedOf(bidA.id)) && (await approvedOf(bidB.id)),
    );

    await outsideNext(() => clearBidWinner({ id: bidB.id, ...ctx }));
    check("and B's award can be taken back", !(await approvedOf(bidB.id)));
    gate = await scopeBidsGate(moving.projectId);
    check("which re-opens the gate", !gate.met, gate.detail);
  } finally {
    const made = await db()
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(like(schema.projects.name, `${NAME}%`));
    const ids = made.map((p) => p.id);
    if (ids.length > 0) {
      await db().delete(schema.projectContracts).where(inArray(schema.projectContracts.projectId, ids));
      const bids = await db()
        .select({ id: schema.bids.id })
        .from(schema.bids)
        .where(inArray(schema.bids.projectId, ids));
      const bidIds = bids.map((b) => b.id);
      if (bidIds.length > 0) {
        await db().delete(schema.bidAccessTokens).where(inArray(schema.bidAccessTokens.bidId, bidIds));
        await db().delete(schema.bidEvents).where(inArray(schema.bidEvents.bidId, bidIds));
        await db().delete(schema.bidLineItems).where(inArray(schema.bidLineItems.bidId, bidIds));
        await db().delete(schema.bids).where(inArray(schema.bids.id, bidIds));
      }
      await db().delete(schema.scopeItems).where(inArray(schema.scopeItems.projectId, ids));
      await db().delete(schema.projectActivityLog).where(inArray(schema.projectActivityLog.projectId, ids));
      await db().delete(schema.projects).where(inArray(schema.projects.id, ids));
    }
    console.log(`\n  teardown: removed ${ids.length} projects`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
