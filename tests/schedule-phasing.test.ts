/**
 * Pure-function tests for target phasing.
 *
 * The model: each date is the day a phase BEGINS, and a phase runs until the day
 * before the next one begins. Nobody types an end date, because an end date that
 * is typed is one that can contradict the next phase's start.
 *
 * Branches covered:
 *  - the ordinary case: a phase ends the day before the next begins
 *  - the last dated phase has no end — Complete is a finish line, not a span
 *  - a blank phase in the middle is skipped rather than ending the chain, so
 *    In Process genuinely runs until Complete when Punch is undated
 *  - same-day and out-of-order dates return their real (zero/negative) length
 *    instead of being silently suppressed
 *  - describeDays says "2 weeks" rather than "14 days", and keeps a fraction
 *    only when the number is long enough to need one
 */
import { describe, expect, test } from "vitest";
import {
  dayBefore,
  daysBetween,
  describeDays,
  describePhaseLengths,
  phaseRun,
  DEFAULT_SCHEDULE_OFFSETS,
} from "../src/lib/schedule-defaults";

const PLAN = {
  pre_walk: "2026-08-31",
  precon: "2026-09-04",
  in_process: "2026-09-07",
  punch: "2026-09-21",
  complete: "2026-09-25",
};

describe("phaseRun", () => {
  test("a phase ends the day before the next one begins", () => {
    expect(phaseRun(PLAN, "in_process")).toEqual({ endsIso: "2026-09-20", days: 14 });
  });

  test("the last dated phase has no end", () => {
    expect(phaseRun(PLAN, "complete")).toBeNull();
  });

  test("an undated phase is skipped, not treated as the end", () => {
    // Punch blank: In Process really does run until the day before Complete.
    expect(phaseRun({ in_process: "2026-09-07", complete: "2026-09-25" }, "in_process")).toEqual({
      endsIso: "2026-09-24",
      days: 18,
    });
  });

  test("an undated phase has no run of its own", () => {
    expect(phaseRun({ complete: "2026-09-25" }, "in_process")).toBeNull();
  });

  test("a phase beginning the same day as the next has no days in it", () => {
    // Not suppressed: the weekend roll can genuinely land two phases on one
    // Monday, and a zero-length phase is worth seeing rather than hiding.
    expect(phaseRun({ precon: "2026-09-04", in_process: "2026-09-04" }, "precon")?.days).toBe(0);
  });

  test("dates in the wrong order report a negative length", () => {
    expect(phaseRun({ precon: "2026-09-10", in_process: "2026-09-04" }, "precon")?.days).toBe(-6);
  });
});

describe("day arithmetic", () => {
  test("dayBefore crosses a month boundary", () => {
    expect(dayBefore("2026-09-01")).toBe("2026-08-31");
  });

  test("daysBetween counts whole days, exclusive of the end", () => {
    expect(daysBetween("2026-09-07", "2026-09-21")).toBe(14);
  });
});

describe("describeDays", () => {
  test("whole weeks read as weeks", () => {
    expect(describeDays(14)).toBe("2 weeks");
    expect(describeDays(7)).toBe("1 week");
  });

  test("short spans read as days", () => {
    expect(describeDays(1)).toBe("1 day");
    expect(describeDays(4)).toBe("4 days");
  });

  test("long spans round to a fraction of a week", () => {
    expect(describeDays(18)).toBe("2.6 weeks");
  });

  test("zero and negative are stated, not hidden", () => {
    expect(describeDays(0)).toBe("no days");
    expect(describeDays(-6)).toBe("-6 days");
  });
});

describe("describePhaseLengths", () => {
  test("turns from-creation offsets into phase lengths", () => {
    // 7 → 10 → 24 → 28 is 3 days of pre-con, 2 weeks of work, 4 days of punch.
    expect(describePhaseLengths(DEFAULT_SCHEDULE_OFFSETS)).toBe(
      "3 days pre-construction · 2 weeks in process · 4 days punch and sign off",
    );
  });
});
