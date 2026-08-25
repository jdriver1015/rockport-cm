/**
 * Pure-function tests for award overlap detection.
 *
 * A project may let its scope to several vendors at once, so what stops two
 * subs being contracted for the same work is not "is anything awarded" but
 * "does this bid's coverage intersect an existing award" — see
 * `overlappingHolders` and `overlapMessage` in src/lib/award-coverage.ts.
 *
 * Branches covered:
 *  - disjoint line sets are allowed through
 *  - a shared line names the bid already holding it
 *  - one holder is reported once however many lines it holds
 *  - several holders all surface, so the message can name them all
 *  - the empty cases: nothing requested, and nothing awarded yet
 *  - the message agrees in number, and falls back to the bid number when the
 *    bid has no vendor
 *  - coverageOf: what a set of bid lines covers, including the lump-sum case
 *    that a count of linked rows got backwards
 */
import { describe, expect, test } from "vitest";
import {
  coverageOf,
  overlapMessage,
  overlappingHolders,
  type LineHolder,
} from "@/lib/award-coverage";

const ace: LineHolder = { bidId: 7, bidNumber: 2, vendorId: 3, vendorName: "Ace" };
const bolt: LineHolder = { bidId: 9, bidNumber: 3, vendorId: 4, vendorName: "Bolt Roofing" };
const nameless: LineHolder = { bidId: 11, bidNumber: 4, vendorId: null, vendorName: null };

describe("overlappingHolders", () => {
  test("lets a disjoint award through", () => {
    const coverage = new Map([
      [1, ace],
      [2, ace],
    ]);
    expect(overlappingHolders(coverage, [3, 4])).toEqual([]);
  });

  test("names the bid already holding a shared line", () => {
    const coverage = new Map([
      [1, ace],
      [2, ace],
    ]);
    expect(overlappingHolders(coverage, [2, 3])).toEqual([ace]);
  });

  test("reports one holder once however many of its lines collide", () => {
    const coverage = new Map([
      [1, ace],
      [2, ace],
      [3, ace],
    ]);
    expect(overlappingHolders(coverage, [1, 2, 3])).toEqual([ace]);
  });

  test("surfaces every colliding holder", () => {
    const coverage = new Map([
      [1, ace],
      [2, bolt],
    ]);
    const holders = overlappingHolders(coverage, [1, 2]);
    expect(holders).toHaveLength(2);
    expect(new Set(holders.map((h) => h.bidId))).toEqual(new Set([7, 9]));
  });

  test("an empty request collides with nothing", () => {
    expect(overlappingHolders(new Map([[1, ace]]), [])).toEqual([]);
  });

  test("nothing awarded yet means nothing to collide with", () => {
    expect(overlappingHolders(new Map(), [1, 2, 3])).toEqual([]);
  });
});

describe("overlapMessage", () => {
  test("agrees in number", () => {
    expect(overlapMessage([ace], 1)).toBe(
      "1 scope line is already awarded to Ace. Award the rest, or replace that award.",
    );
    expect(overlapMessage([ace], 3)).toBe(
      "3 scope lines are already awarded to Ace. Award the rest, or replace that award.",
    );
  });

  test("joins two holders", () => {
    expect(overlapMessage([ace, bolt], 2)).toMatch(/awarded to Ace and Bolt Roofing\./);
  });

  test("falls back to the bid number when the bid has no vendor", () => {
    expect(overlapMessage([nameless], 1)).toMatch(/awarded to bid #4\./);
  });
});

describe("coverageOf", () => {
  const live = [1, 2, 3, 4, 5];

  test("a lump-sum bid — every line manual — covers the whole live scope", () => {
    // The bug this replaced: counting linked rows scored such a bid at zero, so
    // the bid gate could never be met on a job quoted as one number.
    expect(coverageOf(live, [null, null])).toEqual([1, 2, 3, 4, 5]);
  });

  test("no lines at all covers the whole live scope", () => {
    expect(coverageOf(live, [])).toEqual([1, 2, 3, 4, 5]);
  });

  test("a scoped bid covers exactly its lines", () => {
    expect(coverageOf(live, [2, 3])).toEqual([2, 3]);
  });

  test("manual lines alongside scoped ones do not widen coverage", () => {
    expect(coverageOf(live, [2, null, 3, null])).toEqual([2, 3]);
  });

  test("duplicate references collapse", () => {
    expect(coverageOf(live, [2, 2, 3])).toEqual([2, 3]);
  });

  test("references to archived or foreign lines are dropped", () => {
    expect(coverageOf(live, [2, 99])).toEqual([2]);
  });

  test("a bid whose every line was archived covers nothing, not everything", () => {
    expect(coverageOf(live, [98, 99])).toEqual([]);
  });

  test("an empty scope cannot be covered by a lump sum", () => {
    expect(coverageOf([], [null])).toEqual([]);
  });

  test("the caller's live list is copied, not aliased", () => {
    const out = coverageOf(live, []);
    out.push(6);
    expect(live).toEqual([1, 2, 3, 4, 5]);
  });
});
