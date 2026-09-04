import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCHEDULE,
  DEFAULT_SCHEDULE_OFFSETS,
  SCHEDULE_KEYS,
  describeSchedule,
  normalizeOffsets,
  nextWeekday,
  scheduleWarnings,
  suggestSchedule,
  toIsoDate,
  weekdayAfter,
} from "@/lib/schedule-defaults";

/** Local-midnight date, so nothing here depends on the runner's timezone. */
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe("weekend roll-forward", () => {
  it("leaves weekdays alone", () => {
    // Mon 2026-08-24 .. Fri 2026-08-28
    for (const d of [24, 25, 26, 27, 28]) {
      expect(toIsoDate(nextWeekday(at(2026, 8, d)))).toBe(`2026-08-${d}`);
    }
  });

  it("rolls Saturday and Sunday to the same Monday", () => {
    expect(toIsoDate(nextWeekday(at(2026, 8, 29)))).toBe("2026-08-31"); // Sat
    expect(toIsoDate(nextWeekday(at(2026, 8, 30)))).toBe("2026-08-31"); // Sun
  });
});

describe("weekdayAfter", () => {
  it("gives the first weekday after seven days", () => {
    // Thu 2026-08-20 + 7 = Thu 2026-08-27, already a weekday.
    expect(toIsoDate(weekdayAfter(at(2026, 8, 20), 7))).toBe("2026-08-27");
    // Sat 2026-08-22 + 7 = Sat 2026-08-29 → Mon 2026-08-31.
    expect(toIsoDate(weekdayAfter(at(2026, 8, 22), 7))).toBe("2026-08-31");
  });

  it("ignores the time of day, so evening and morning agree", () => {
    const morning = new Date(2026, 7, 20, 8, 30);
    const evening = new Date(2026, 7, 20, 23, 45);
    expect(toIsoDate(weekdayAfter(morning, 7))).toBe(toIsoDate(weekdayAfter(evening, 7)));
  });

  it("accepts negative offsets", () => {
    // A pre-walk that already happened is a real thing to record.
    // Thu 2026-08-20 - 6 = Fri 2026-08-14, already a weekday.
    expect(toIsoDate(weekdayAfter(at(2026, 8, 20), -6))).toBe("2026-08-14");
    // - 12 = Sat 2026-08-08, so it still rolls forward to the Monday.
    expect(toIsoDate(weekdayAfter(at(2026, 8, 20), -12))).toBe("2026-08-10");
  });
});

describe("suggestSchedule", () => {
  it("produces the whole schedule in order from a Thursday", () => {
    const dates = suggestSchedule(DEFAULT_SCHEDULE, at(2026, 8, 20)); // Thu
    expect(dates).toEqual({
      pre_walk: "2026-08-24", // +2 = Sat → Mon
      precon: "2026-08-27", // +7 = Thu
      in_process: "2026-08-31", // +10 = Sun → Mon
      punch: "2026-09-14", // +24 = Mon
      complete: "2026-09-17", // +28 = Fri
    });
  });

  it("never suggests a weekend, whatever day it is run", () => {
    for (let i = 0; i < 14; i++) {
      const dates = suggestSchedule(DEFAULT_SCHEDULE, at(2026, 8, 17 + i));
      for (const key of SCHEDULE_KEYS) {
        const day = new Date(`${dates[key]}T00:00:00`).getDay();
        expect(day, `${key} on run day +${i} (${dates[key]})`).not.toBe(0);
        expect(day, `${key} on run day +${i} (${dates[key]})`).not.toBe(6);
      }
    }
  });

  it("keeps the schedule in order on every run day", () => {
    for (let i = 0; i < 14; i++) {
      const dates = suggestSchedule(DEFAULT_SCHEDULE, at(2026, 8, 17 + i));
      // Weekend roll-forward can tie two dates together but must never invert
      // them, which is what scheduleWarnings reports on.
      expect(scheduleWarnings(dates), `run day +${i}`).toEqual([]);
    }
  });

  it("returns blanks when suggestions are switched off", () => {
    const dates = suggestSchedule({ ...DEFAULT_SCHEDULE, enabled: false }, at(2026, 8, 20));
    expect(Object.values(dates).every((v) => v === "")).toBe(true);
  });
});

describe("the default schedule matches what it claims", () => {
  it("is about two and a half weeks from commencement to sign-off", () => {
    const span = DEFAULT_SCHEDULE_OFFSETS.complete - DEFAULT_SCHEDULE_OFFSETS.in_process;
    expect(span / 7).toBeGreaterThanOrEqual(2.4);
    expect(span / 7).toBeLessThanOrEqual(2.7);
    expect(describeSchedule(DEFAULT_SCHEDULE_OFFSETS)).toContain("2.6 weeks");
  });

  it("signs the contract a week out", () => {
    expect(DEFAULT_SCHEDULE_OFFSETS.precon).toBe(7);
  });

  it("orders every key", () => {
    const values = SCHEDULE_KEYS.map((k) => DEFAULT_SCHEDULE_OFFSETS[k]);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });
});

describe("normalizeOffsets", () => {
  it("fills missing keys from the defaults", () => {
    expect(normalizeOffsets({ precon: 14 })).toEqual({ ...DEFAULT_SCHEDULE_OFFSETS, precon: 14 });
  });

  it("survives junk jsonb rather than yielding an invalid date", () => {
    for (const junk of [null, undefined, "nonsense", 5, [], { precon: "soon" }, { precon: NaN }]) {
      expect(normalizeOffsets(junk)).toEqual(DEFAULT_SCHEDULE_OFFSETS);
    }
  });

  it("drops keys it does not know", () => {
    expect(normalizeOffsets({ ...DEFAULT_SCHEDULE_OFFSETS, made_up: 99 })).toEqual(
      DEFAULT_SCHEDULE_OFFSETS,
    );
  });

  it("truncates fractional days", () => {
    expect(normalizeOffsets({ precon: 7.9 }).precon).toBe(7);
  });
});

describe("scheduleWarnings", () => {
  it("catches the screenshot's case — completion before the pre-walk", () => {
    const warnings = scheduleWarnings({
      pre_walk: "2026-08-19",
      in_process: "2026-08-07",
      complete: "2026-08-14",
    });
    expect(warnings).toContain("In Process is before Pre-walk");
  });

  it("says nothing about blank dates", () => {
    expect(scheduleWarnings({ pre_walk: "", precon: "2026-08-27", complete: "" })).toEqual([]);
  });

  it("compares only the dates that are filled in", () => {
    // punch is blank, so complete is checked against in_process instead.
    expect(
      scheduleWarnings({ in_process: "2026-09-01", punch: "", complete: "2026-08-01" }),
    ).toEqual(["Complete is before In Process"]);
  });
});
