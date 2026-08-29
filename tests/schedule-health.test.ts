/**
 * Pure-function tests for the schedule health status.
 *
 * The metric is slip against the ORIGINAL plan, not days to the next
 * milestone. Days-to-next cannot work here: a missed target is pushed to today
 * by the nightly pass, so it can never read negative and every project reports
 * zero — measured on live data, all seven read 0 while their real slip ranged
 * from 1 to 5 working days.
 *
 * The threshold is a share of the plan rather than a fixed number of days,
 * because four days on a three-week turn is a wobble and four days on a
 * three-day fix is most of it.
 */
import { describe, expect, test } from "vitest";
import { statusOf, LATE_RATIO } from "../src/lib/target-slip";

describe("statusOf", () => {
  test("a finish that has not moved is on time", () => {
    expect(statusOf(0, 20)).toBe("on_time");
  });

  test("negative slip is still on time, not a special case", () => {
    // A re-base can hand days back when a transition turns out to have happened
    // on schedule after all.
    expect(statusOf(-3, 20)).toBe("on_time");
  });

  test("a small share of a long plan is slipping, not late", () => {
    // 3 of 20 working days is 15%.
    expect(statusOf(3, 20)).toBe("slipping");
  });

  test("the same absolute slip on a short job is late", () => {
    // 3 of 5 working days is 60% — the whole point of a proportional threshold.
    expect(statusOf(3, 5)).toBe("late");
  });

  test("the boundary is exclusive, so exactly the ratio is not yet late", () => {
    expect(statusOf(4, 20)).toBe("slipping"); // exactly 20%
    expect(statusOf(5, 20)).toBe("late"); // 25%
    expect(LATE_RATIO).toBe(0.2);
  });

  test("slip with no plan to measure against is reported, not guessed into red", () => {
    expect(statusOf(4, 0)).toBe("slipping");
  });

  test("no slip and no plan is still on time", () => {
    expect(statusOf(0, 0)).toBe("on_time");
  });
});
