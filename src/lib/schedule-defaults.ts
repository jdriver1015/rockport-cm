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
 * Roll a weekend date forward to the following Monday.
 *
 * Crews do not mobilize on a Saturday, so a suggested date landing on one is
 * wrong rather than merely untidy. Applied to each date independently, which is
 * why two milestones a few days apart can end up on the same Monday — better a
 * visibly tight pair the scheduler adjusts than a date nobody will work.
 */
export function nextWeekday(date: Date): Date {
  const day = date.getDay();
  if (day === 6) return new Date(date.getTime() + 2 * MS_PER_DAY); // Sat → Mon
  if (day === 0) return new Date(date.getTime() + MS_PER_DAY); // Sun → Mon
  return date;
}

/** The first weekday on or after `from` plus `days`. */
export function weekdayAfter(from: Date, days: number): Date {
  // Normalized to local midnight first so a project created late in the evening
  // gets the same suggestion as one created that morning.
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return nextWeekday(new Date(base.getTime() + days * MS_PER_DAY));
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

/**
 * How the schedule reads in plain language — "about 2.5 weeks from commencement
 * to sign-off" — for the settings page and the wizard's hint.
 */
export function describeSchedule(offsets: Record<ScheduleKey, number>): string {
  const weeks = (offsets.complete - offsets.in_process) / 7;
  const rounded = Math.round(weeks * 10) / 10;
  return `about ${rounded} week${rounded === 1 ? "" : "s"} from work commencing to sign-off`;
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
