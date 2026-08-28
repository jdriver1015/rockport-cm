/**
 * End-to-end probe of the bid invitation flow, against the real database.
 *
 * Covers what unit tests cannot: a scope confirmed, sent to two vendors for one
 * line with a due date, a token minted and resolved, a vendor typing a price
 * without submitting, and the trail that comes out of it. The interesting cases
 * are the negatives — a draft must NOT mark a bid received, a second save in the
 * same hour must NOT count twice, and a vendor already holding a live request
 * must NOT be sent a duplicate.
 *
 * Creates its own project, asserts, and DELETES everything it made in a finally
 * block. It touches no existing row. Safe to re-run.
 *
 *   npx tsx scripts/probe-bid-invite-flow.ts
 *
 * Exits non-zero if any assertion fails.
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../src/db";
import { confirmScopeRows } from "../src/lib/scope-confirm";
import { sendBidPackageRows, readBidPackage } from "../src/lib/bid-package";
import { issueBidToken, lookupPortalBid, saveDraftPrices } from "../src/lib/bid-portal";
import { recordBidEvent, readBidEvents, recordOncePerHour, summarise } from "../src/lib/bid-events";

let pass = 0, fail = 0;
const check = (l: string, ok: boolean, d = "") =>
  (ok ? pass++ : fail++, console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? `  — ${d}` : ""}`));

async function main() {
  let projectId = 0;
  try {
    const [p] = await db().insert(schema.projects)
      .values({ propertyId: 1, kind: "common", name: "ZZ probe — invite flow", phase: "precon" })
      .returning({ id: schema.projects.id });
    projectId = p.id;

    const lines = await db().insert(schema.scopeItems).values([
      { projectId, item: "Invite line A", costCodeId: 1, quantity: "1", unitPrice: "1000",
        materialQuality: "Probe description.", sortOrder: 1 },
      { projectId, item: "Invite line B", costCodeId: 2, quantity: "1", unitPrice: "2000",
        materialQuality: "Probe description.", sortOrder: 2 },
    ]).returning({ id: schema.scopeItems.id });
    const ids = lines.map((l) => l.id);

    const confirmed = await confirmScopeRows(projectId);
    check("scope confirms (priced + named + described)", confirmed.ok,
      confirmed.ok ? "" : confirmed.error);

    // ---- send to two vendors, only line A, with a due date
    const res = await sendBidPackageRows(projectId, [1, 2], [ids[0]], "2026-09-15");
    check("send succeeds", res.ok, res.ok ? `${res.sent} sent` : res.error);
    if (!res.ok) return;

    check("returns the bids it created", res.created.length === 2, `${res.created.length}`);
    check("each created row names its vendor",
      res.created.every((c) => c.bidId > 0 && c.vendorId > 0));

    const bids = await db().select({ id: schema.bids.id, dueDate: schema.bids.dueDate, status: schema.bids.status })
      .from(schema.bids).where(eq(schema.bids.projectId, projectId));
    check("due date lands on every bid", bids.every((b) => b.dueDate === "2026-09-15"),
      bids.map((b) => b.dueDate).join(", "));
    check("bids are marked sent", bids.every((b) => b.status === "sent"));

    // ---- only the chosen line is on the request
    const linesOut = await db().select({ scopeItemId: schema.bidLineItems.scopeItemId })
      .from(schema.bidLineItems).where(inArray(schema.bidLineItems.bidId, res.created.map((c) => c.bidId)));
    check("only the selected scope line was sent",
      linesOut.every((l) => l.scopeItemId === ids[0]), `${linesOut.length} line rows`);

    // ---- a token per bid, resolvable
    const first = res.created[0];
    const { token } = await issueBidToken(first.bidId, null);
    const found = await lookupPortalBid(token);
    check("the minted token resolves to that bid", found.ok && found.bid.bidId === first.bidId);

    await recordBidEvent(first.bidId, "invited", { to: "probe@example.com" });
    const evs = (await readBidEvents([first.bidId])).get(first.bidId) ?? [];
    const s = summarise(evs);
    check("invitation is on the trail", s.invitedAt != null, `${evs.map((e) => e.kind).join(", ")}`);

    // ---- a vendor typing a price without submitting
    const bidLines = await db().select({ id: schema.bidLineItems.id })
      .from(schema.bidLineItems).where(eq(schema.bidLineItems.bidId, first.bidId));
    const draft = await saveDraftPrices(token, [{ lineId: bidLines[0].id, amount: 1234 }]);
    check("draft saves without submitting", draft.ok, draft.ok ? `${draft.saved} line` : draft.error);

    const afterDraft = await db().query.bids.findFirst({ where: eq(schema.bids.id, first.bidId) });
    check("the bid is NOT marked received by a draft", afterDraft?.status === "sent",
      `${afterDraft?.status}`);
    const amount = await db().select({ amount: schema.bidLineItems.amount })
      .from(schema.bidLineItems).where(eq(schema.bidLineItems.id, bidLines[0].id));
    check("the typed price is kept", Number(amount[0].amount) === 1234, `${amount[0].amount}`);

    const evs2 = (await readBidEvents([first.bidId])).get(first.bidId) ?? [];
    const s2 = summarise(evs2);
    check("started pricing shows on the trail", s2.startedPricing === true,
      evs2.map((e) => e.kind).join(", "));
    check("but not submitted", s2.submittedAt === null);

    await saveDraftPrices(token, [{ lineId: bidLines[0].id, amount: 1500 }]);
    const evs3 = (await readBidEvents([first.bidId])).get(first.bidId) ?? [];
    check("a second save in the same hour is not double counted",
      evs3.filter((e) => e.kind === "priced").length === 1,
      `${evs3.filter((e) => e.kind === "priced").length}`);

    // ---- opening the portal is recorded once an hour, not once a render
    // The dedup is a single INSERT ... WHERE NOT EXISTS with an enum cast, and a
    // cast that does not match the type would be swallowed by the recorder's own
    // catch — so the first call has to be seen to WRITE, not merely to not throw.
    const opensNow = async () =>
      ((await readBidEvents([first.bidId])).get(first.bidId) ?? [])
        .filter((e) => e.kind === "link_opened").length;

    const before = await opensNow();
    await recordOncePerHour(first.bidId, "link_opened");
    const afterOne = await opensNow();
    check("opening the portal is recorded", afterOne === before + 1, `${before} -> ${afterOne}`);

    await recordOncePerHour(first.bidId, "link_opened");
    await recordOncePerHour(first.bidId, "link_opened");
    check("re-renders inside the hour do not add visits",
      (await opensNow()) === afterOne, `${await opensNow()}`);

    // ---- the package now feeds the vendor step
    const pkg = await readBidPackage(1, projectId);
    check("package carries each vendor's progress",
      pkg.bids.every((b) => "progress" in b),
      pkg.bids.map((b) => `${b.vendorName}:${b.progress.startedPricing ? "pricing" : "idle"}`).join(", "));
    check("package exposes contact emails for the vendor step",
      pkg.vendors.every((v) => "contactEmail" in v),
      pkg.vendors.map((v) => `${v.name}:${v.contactEmail ?? "none"}`).join(", "));

    // ---- sending again to the same vendor is refused, not duplicated
    const again = await sendBidPackageRows(projectId, [1], [ids[0]], null);
    check("a vendor already holding a live request is skipped",
      again.ok && again.sent === 0 && again.skipped.length === 1,
      again.ok ? again.skipped.map((s) => s.reason).join() : again.error);
  } finally {
    if (projectId) {
      const bids = await db().select({ id: schema.bids.id }).from(schema.bids).where(eq(schema.bids.projectId, projectId));
      const bidIds = bids.map((b) => b.id);
      if (bidIds.length) {
        await db().delete(schema.bidAccessTokens).where(inArray(schema.bidAccessTokens.bidId, bidIds));
        await db().delete(schema.bidEvents).where(inArray(schema.bidEvents.bidId, bidIds));
        await db().delete(schema.bidLineItems).where(inArray(schema.bidLineItems.bidId, bidIds));
      }
      await db().delete(schema.bids).where(eq(schema.bids.projectId, projectId));
      await db().delete(schema.scopeItems).where(eq(schema.scopeItems.projectId, projectId));
      await db().delete(schema.projects).where(eq(schema.projects.id, projectId));
      console.log("  teardown: removed");
    }
    console.log(`\n${pass} passed, ${fail} failed`);
  }
}
main().then(() => process.exit(fail > 0 ? 1 : 0)).catch((e) => { console.error(e); process.exit(1); });
