/**
 * Pure-function tests for the scheduling calendar.
 *
 * Two things are being pinned here.
 *
 * DST. Date arithmetic used to run on epoch milliseconds, and `t - 86_400_000`
 * is not "yesterday": the day a clock springs forward is 23 hours long, so
 * local midnight minus a fixed day lands at 23:00 the day BEFORE that.
 * dayBefore("2026-03-09") returned 2026-03-07. Mon 9 Mar 2026 is exactly where
 * nextWeekday parks a suggested date, so this sat on the default path.
 *
 * Business days. Targets push forward when a phase is missed, and a push that
 * counted calendar days would charge a Friday miss three days for a weekend
 * nobody was working, then land the new target on a Saturday.
 */
import { describe, expect, test } from "vitest";
import {
  addBusinessDays,
  businessDaysBetween,
  dateFromIso,
  dayBefore,
  nextWeekday,
  toIsoDate,
} from "../src/lib/schedule-defaults";

describe("DST-safe day arithmetic", () => {
  test("dayBefore survives the spring-forward", () => {
    // America/Chicago springs forward Sun 8 Mar 2026.
    expect(dayBefore("2026-03-09")).toBe("2026-03-08");
    expect(dayBefore("2026-03-10")).toBe("2026-03-09");
  });

  test("dayBefore survives the fall-back and the new year", () => {
    expect(dayBefore("2026-11-02")).toBe("2026-11-01");
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
  });

  test("a weekend roll crossing the DST boundary lands on the Monday", () => {
    expect(toIsoDate(nextWeekday(dateFromIso("2026-03-07")))).toBe("2026-03-09");
  });
});

describe("addBusinessDays", () => {
  test("five working days is a week", () => {
    expect(addBusinessDays("2026-09-07", 5)).toBe("2026-09-14");
    expect(addBusinessDays("2026-09-07", 10)).toBe("2026-09-21");
  });

  test("steps over the weekend rather than through it", () => {
    // Thu + 3 working days is Tuesday, not Sunday.
    expect(addBusinessDays("2026-09-10", 3)).toBe("2026-09-15");
  });

  test("zero rolls a weekend date onto the Monday without advancing", () => {
    expect(addBusinessDays("2026-09-12", 0)).toBe("2026-09-14");
    expect(addBusinessDays("2026-09-13", 1)).toBe("2026-09-15");
  });

  test("counts backwards, which is what undoing a slip needs", () => {
    expect(addBusinessDays("2026-09-21", -3)).toBe("2026-09-16");
  });

  test("crosses a DST weekend", () => {
    expect(addBusinessDays("2026-03-06", 1)).toBe("2026-03-09");
  });
});

describe("businessDaysBetween", () => {
  test("two calendar weeks are ten working days", () => {
    expect(businessDaysBetween("2026-09-07", "2026-09-21")).toBe(10);
  });

  test("a weekend in the middle is not charged", () => {
    expect(businessDaysBetween("2026-09-10", "2026-09-15")).toBe(3);
    // The same span in calendar days is 5 — this is the difference that stops a
    // Friday miss picked up on Monday costing three days.
    expect(businessDaysBetween("2026-03-06", "2026-03-09")).toBe(1);
  });

  test("same day is zero and backwards is negative", () => {
    expect(businessDaysBetween("2026-09-07", "2026-09-07")).toBe(0);
    expect(businessDaysBetween("2026-09-21", "2026-09-07")).toBe(-10);
  });
});
