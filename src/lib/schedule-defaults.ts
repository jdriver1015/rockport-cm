import { DEFAULT_MILESTONES } from "@/lib/milestones";
import type { ProjectPhaseKey } from "@/lib/stages";

/**
 * The suggested schedule for a new unit turn: how long after creation each
 * default milestone is expected to land.
 *
 * Offsets are DAYS FROM THE DAY THE PROJECT IS CREATED, all measured from that
 * one origin rather than chained off each other. A chain reads more like a plan
 * ("mobilize three days after signing"), but it means editing one date silently
 * moves every later one. From a single origin each suggested date is
 * independently explainable, and changing one changes only that one.
 *
 * Pure, so the wizard can show exactly the dates the settings describe and the
 * settings page can preview what a project created today would get.
 */

/**
 * TARGET PHASING: each date is the day a phase BEGINS. A phase runs until the
 * day before the next one begins, so four begin dates describe four spans
 * without anyone typing an end date — and an end date typed separately is an
 * end date that can contradict the next phase's start.
 *
 * Complete is the exception: it begins and does not end. It is the finish line,
 * and it is what "target completion" means.
 */

/** "pre_walk" is not a milestone — it is the walk that produces the scope. */
export const PRE_WALK_KEY = "pre_walk";
export type ScheduleKey = typeof PRE_WALK_KEY | ProjectPhaseKey;

export type ScheduleOffsets = Partial<Record<ScheduleKey, number>>;

/**
 * Sign in a week, mobilize three days later, two weeks of work, four days of
 * punch — about two and a half weeks from commencement to sign-off.
 *
 * These are the fallback when the portfolio defaults row is missing or holds a
 * key we don't recognise; the editable copy lives in interior_default_settings.
 */
export const DEFAULT_SCHEDULE_OFFSETS: Record<ScheduleKey, number> = {
  pre_walk: 2,
  precon: 7,
  in_process: 10,
  punch: 24,
  complete: 28,
};

export type ScheduleSettings = {
  /** False leaves the wizard's dates blank rather than suggesting any. */
  enabled: boolean;
  offsets: Record<ScheduleKey, number>;
};

export const DEFAULT_SCHEDULE: ScheduleSettings = {
  enabled: true,
  offsets: DEFAULT_SCHEDULE_OFFSETS,
};

/** The order the schedule reads in, pre-walk first then the four milestones. */
export const SCHEDULE_KEYS: ScheduleKey[] = [
  PRE_WALK_KEY,
  ...DEFAULT_MILESTONES.map((m) => m.phase),
];

/** The four phases in order — the schedule minus the walk that precedes it. */
export const PHASE_KEYS: ProjectPhaseKey[] = DEFAULT_MILESTONES.map((m) => m.phase);

export const SCHEDULE_LABELS: Record<ScheduleKey, string> = {
  pre_walk: "Pre-walk",
  ...(Object.fromEntries(DEFAULT_MILESTONES.map((m) => [m.phase, m.label])) as Record<
    ProjectPhaseKey,
    string
  >),
};

/**
 * Coerce a stored offsets blob into a complete, sane set.
 *
 * jsonb accepts any shape and these are hand-editable, so an unknown key,
 * a missing one or a non-integer all have to resolve to something rather than
 * producing an invalid date in the wizard. Negative offsets are allowed — a
 * pre-walk that already happened is a real thing to record.
 */
export function normalizeOffsets(raw: unknown): Record<ScheduleKey, number> {
  const source = (raw ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_SCHEDULE_OFFSETS };
  for (const key of SCHEDULE_KEYS) {
    const value = Number(source[key]);
    if (Number.isFinite(value)) out[key] = Math.trunc(value);
  }
  return out;
}

const MS_PER_DAY = 86_400_000;

/**
 * The timezone "today" means for scheduling purposes.
 *
 * Named explicitly because neither end of the wire knows it otherwise: the
 * server runs UTC in production and the browser runs whatever the viewer's
 * machine says. Deriving a date from either produced a schedule that shifted by
 * a day after ~7pm Central and disagreed between the server-rendered HTML and
 * the hydrated page. Anchoring on one zone makes the suggestion deterministic
 * and matches what the team means by today.
 *
 * Eastern-timezone properties are an hour ahead of this, which only changes the
 * answer between 11pm and midnight Central — a window nobody schedules in.
 */
export const BUSINESS_TIME_ZONE = "America/Chicago";

/** Midnight today in the business timezone, whatever the host clock says. */
export function todayInBusinessZone(now: Date = new Date()): Date {
  // en-CA formats as yyyy-mm-dd, which is the one locale that needs no reordering.
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return dateFromIso(iso);
}

/** An ISO yyyy-mm-dd as a local-midnight Date, safe to do day arithmetic on. */
export function dateFromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Local-calendar ISO date (yyyy-mm-dd) — never a UTC shift of the day. */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Add days by CALENDAR FIELDS, never by epoch milliseconds.
 *
 * `t + n * 86_400_000` is not "n days later". The day a clock springs forward is
 * 23 hours long, so local midnight minus 86,400,000ms lands at 23:00 the day
 * before that — and reading the calendar fields off it gives the wrong date.
 * dayBefore("2026-03-09") returned 2026-03-07. Mon 9 Mar 2026 is exactly where
 * nextWeekday parks a suggested date, so this was on the default path.
 *
 * new Date(y, m, d + n) is defined to normalise overflow against the local
 * calendar, which is the arithmetic people mean.
 */
export function addDays(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

/** Saturday or Sunday — not a day anybody mobilises a crew. */
export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * `n` BUSINESS days from `iso`, skipping weekends.
 *
 * Zero is meaningful: it rolls a weekend date onto the following Monday without
 * advancing. Negative counts backwards, which is what un-doing a slip needs.
 */
export function addBusinessDays(iso: string, n: number): string {
  let d = dateFromIso(iso);
  // Count from a working day. A gap measured from a Saturday is a gap from a
  // day the work could not have started on.
  while (isWeekend(d)) d = addDays(d, 1);
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (!isWeekend(d)) left--;
  }
  while (left < 0) {
    d = addDays(d, -1);
    if (!isWeekend(d)) left++;
  }
  return toIsoDate(d);
}

/**
 * Working days from `from` up to but not including `to`. Negative if `to` is
 * earlier — a phase whose dates run backwards should report that, not zero.
 */
export function businessDaysBetween(from: string, to: string): number {
  if (from === to) return 0;
  const backwards = to < from;
  const start = dateFromIso(backwards ? to : from);
  const end = dateFromIso(backwards ? from : to);
  let count = 0;
  let d = start;
  while (d < end) {
    d = addDays(d, 1);
    if (!isWeekend(d)) count++;
  }
  return backwards ? -count : count;
}

/**
 * Roll a weekend date forward to the following Monday.
 *
 * Crews do not mobilize on a Saturday, so a suggested date landing on one is
 * wrong rather than merely untidy. Applied to each date independently, which is
 * why two milestones a few days apart can end up on the same Monday — better a
 * visibly tight pair the scheduler adjusts than a date nobody will work.
 */
export function nextWeekday(date: Date): Date {
  const day = date.getDay();
  if (day === 6) return addDays(date, 2); // Sat → Mon
  if (day === 0) return addDays(date, 1); // Sun → Mon
  return date;
}

/** The first weekday on or after `from` plus `days`. */
export function weekdayAfter(from: Date, days: number): Date {
  // Normalized to local midnight first so a project created late in the evening
  // gets the same suggestion as one created that morning.
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return nextWeekday(addDays(base, days));
}

/**
 * The suggested date for every key, as ISO strings ready for a date input.
 *
 * Returns empty strings when suggestions are switched off, so the caller can
 * spread this straight into form state either way.
 */
export function suggestSchedule(
  settings: ScheduleSettings,
  today: Date,
): Record<ScheduleKey, string> {
  const out = {} as Record<ScheduleKey, string>;
  for (const key of SCHEDULE_KEYS) {
    out[key] = settings.enabled ? toIsoDate(weekdayAfter(today, settings.offsets[key])) : "";
  }
  return out;
}

/** Every key blank — the shape callers need when suggestions are switched off. */
export function blankSchedule(): Record<ScheduleKey, string> {
  return Object.fromEntries(SCHEDULE_KEYS.map((k) => [k, ""])) as Record<ScheduleKey, string>;
}

/** The day before `iso` — where a phase ends when the next one begins on `iso`. */
export function dayBefore(iso: string): string {
  return toIsoDate(addDays(dateFromIso(iso), -1));
}

/**
 * Whole CALENDAR days from `from` up to but not including `to` — wall time, for
 * describing how long a phase occupies. Scheduling arithmetic uses
 * businessDaysBetween instead.
 *
 * Math.round absorbs the 23- and 25-hour days, so this one was never wrong; it
 * is kept on epoch ms because rounding a difference is exactly where that is safe.
 */
export function daysBetween(from: string, to: string): number {
  return Math.round((dateFromIso(to).getTime() - dateFromIso(from).getTime()) / MS_PER_DAY);
}

export type PhaseRun = {
  /** Last day of the phase — the day before the next one begins. */
  endsIso: string;
  /** How many days it runs. Zero or negative means the dates disagree. */
  days: number;
};

/**
 * When a phase ends and how long it runs, derived from the phase that follows.
 *
 * Skips blank phases rather than giving up on them: with In Process dated,
 * Punch blank and Complete dated, In Process genuinely runs until the day
 * before Complete. Returns null for the last dated phase — nothing follows it,
 * so it has no end, which is exactly what Complete is.
 *
 * Zero and negative days are returned rather than suppressed. A phase beginning
 * the same day as the next one has no days in it, and that is worth showing;
 * `scheduleWarnings` names the out-of-order case separately.
 */
export function phaseRun(
  dates: Partial<Record<ScheduleKey, string>>,
  key: ProjectPhaseKey,
): PhaseRun | null {
  const begin = dates[key];
  if (!begin) return null;
  const after = PHASE_KEYS.slice(PHASE_KEYS.indexOf(key) + 1);
  const nextKey = after.find((k) => !!dates[k]);
  if (!nextKey) return null;
  const next = dates[nextKey] as string;
  return { endsIso: dayBefore(next), days: daysBetween(begin, next) };
}

/** A day count as a person would say it — "4 days", "2 weeks", "2.6 weeks". */
export function describeDays(days: number): string {
  if (days === 0) return "no days";
  if (days < 0) return `${days} days`;
  if (days === 1) return "1 day";
  if (days % 7 === 0) {
    const weeks = days / 7;
    return `${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  if (days <= 13) return `${days} days`;
  return `${Math.round((days / 7) * 10) / 10} weeks`;
}

/**
 * How the schedule reads in plain language — "about 2.5 weeks from commencement
 * to sign-off" — for the settings page and the wizard's hint.
 */
export function describeSchedule(offsets: Record<ScheduleKey, number>): string {
  const weeks = (offsets.complete - offsets.in_process) / 7;
  const rounded = Math.round(weeks * 10) / 10;
  return `about ${rounded} week${rounded === 1 ? "" : "s"} from work commencing to sign-off`;
}

/**
 * Each phase's length, for the settings panel — "3 days pre-con · 2 weeks in
 * process · 4 days punch". The offsets are days from creation, so the gap
 * between two of them IS the length of the earlier phase.
 */
export function describePhaseLengths(offsets: Record<ScheduleKey, number>): string {
  const parts: string[] = [];
  for (let i = 0; i < PHASE_KEYS.length - 1; i++) {
    const key = PHASE_KEYS[i];
    const days = offsets[PHASE_KEYS[i + 1]] - offsets[key];
    parts.push(`${describeDays(days)} ${SCHEDULE_LABELS[key].toLowerCase()}`);
  }
  return parts.join(" · ");
}

/** Dates out of order — the thing three free-floating fields could not catch. */
export function scheduleWarnings(dates: Partial<Record<ScheduleKey, string>>): string[] {
  const warnings: string[] = [];
  const filled = SCHEDULE_KEYS.filter((k) => !!dates[k]);
  for (let i = 1; i < filled.length; i++) {
    const prev = filled[i - 1];
    const curr = filled[i];
    if ((dates[curr] as string) < (dates[prev] as string)) {
      warnings.push(`${SCHEDULE_LABELS[curr]} is before ${SCHEDULE_LABELS[prev]}`);
    }
  }
  return warnings;
}
