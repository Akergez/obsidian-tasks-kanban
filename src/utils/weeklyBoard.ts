import { renderTemplate } from "../query/template";
import type { DateColumnConfig } from "../types/persistence";
import { todayISO } from "./dateColumns";

/** Column titles for the seven days, Monday first. */
export const WEEKDAY_TITLES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** Milliseconds in a week, used only to count whole weeks apart. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The Monday of the week containing `date`, at local midnight.
 *
 * Weeks start on Monday, matching ISO-8601 (and unlike the Sunday-based weeks
 * the `in this week` query filter uses, which follows the Tasks plugin).
 */
export function startOfWeek(date: Date): Date {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay() is 0 for Sunday, so shift it to "days since Monday".
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

/**
 * The ISO-8601 name of the week starting at `monday`, e.g. `2026-W35`.
 *
 * The week's Thursday decides both parts, which is what makes the turn of the
 * year come out right: the week of 2027-01-01 is `2026-W53`, and the week of
 * 2025-12-29 is already `2026-W01`.
 *
 * Sortable and unambiguous, which is what makes it the label the week
 * navigator shows above a week board.
 */
export function isoWeekName(monday: Date): string {
  const thursday = new Date(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + 3,
  );
  const year = thursday.getFullYear();
  // January 4th is always in ISO week 1, so its Monday starts the year.
  const firstMonday = startOfWeek(new Date(year, 0, 4));
  // Rounded whole weeks: a DST shift moves the difference by an hour at most.
  const week =
    Math.round((monday.getTime() - firstMonday.getTime()) / WEEK_MS) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The seven days of the week starting at `monday`, as `YYYY-MM-DD`. */
export function weekDays(monday: Date): string[] {
  return WEEKDAY_TITLES.map((_title, offset) =>
    todayISO(
      new Date(
        monday.getFullYear(),
        monday.getMonth(),
        monday.getDate() + offset,
      ),
    ),
  );
}

/**
 * A task's **preplanning tag**: `#w35_2026` says "this belongs to week 35 of
 * 2026" without committing it to a day. Written by hand in the note, or by a
 * board action, and read by the planner's pool to keep other weeks' work out.
 *
 * The tag is not built here — a week board spells it out of
 * {@link weekVariables} (`#w{{week}}_{{year}}`), so the shape of the tag is the
 * user's to change. This function exists for tests and for documenting the one
 * spelling the default weekly board uses.
 */
export function weekTag(monday: Date): string {
  const { week, year } = weekVariables(monday);
  return `#w${week}_${year}`;
}

/** A day, as `YYYY-MM-DD`, `offset` days after `monday`. */
function dayAfter(monday: Date, offset: number): string {
  return todayISO(
    new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() + offset,
    ),
  );
}

/**
 * The values a week board can substitute — everything about a week that a
 * board document might need to name.
 *
 * The neighbouring weeks are given as their own number/year pairs rather than
 * left to arithmetic in the document: week 53 of 2026 is followed by week 1 of
 * **2027**, so `{{week}} + 1` would be wrong exactly when it matters.
 *
 * Week numbers come in two spellings because both are in use: the tag is
 * written unpadded (`#w5_2026`) and the ISO name padded (`2026-W05`).
 */
export function weekVariables(monday: Date): Record<string, string> {
  const week = (date: Date) => {
    const [year, number] = isoWeekName(date).split("-W");
    return { year, ww: number, week: String(Number(number)) };
  };

  const this_ = week(monday);
  const next = week(
    new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7),
  );
  const previous = week(
    new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7),
  );

  const days: Record<string, string> = {};
  WEEKDAY_TITLES.forEach((title, offset) => {
    days[title.toLowerCase()] = dayAfter(monday, offset);
  });

  return {
    week: this_.week,
    ww: this_.ww,
    year: this_.year,
    nextWeek: next.week,
    nextWw: next.ww,
    nextYear: next.year,
    prevWeek: previous.week,
    prevWw: previous.ww,
    prevYear: previous.year,
    ...days,
    nextMonday: dayAfter(monday, 7),
  };
}

/** The Monday `count` weeks after `monday` (negative counts go back). */
export function addWeeks(monday: Date, count: number): Date {
  return new Date(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + count * 7,
  );
}

/**
 * Month names, spelled out here rather than through `toLocaleDateString`, so a
 * column header reads the same on every machine — and so a test can assert it.
 */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** A `YYYY-MM-DD` day as `24 Aug`, for a column header. */
function dayLabel(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

/**
 * The seven day columns of the week starting at `monday`.
 *
 * A week board keeps no columns in its file — these are built for whichever
 * week is being looked at, which is what lets one note serve every week. The
 * ids are the weekday, not the date, so folding Saturday keeps it folded as you
 * page through the weeks; the titles carry the date, because "Monday" alone
 * says nothing once you have paged three weeks back.
 */
export function weekColumns(monday: Date): DateColumnConfig[] {
  return weekDays(monday).map((date, offset) => ({
    id: `week:${WEEKDAY_TITLES[offset].toLowerCase()}`,
    title: `${WEEKDAY_TITLES[offset]} ${dayLabel(date)}`,
    date,
  }));
}

/** The week as a span of days, e.g. `24 Aug – 30 Aug 2026`. */
export function weekRange(monday: Date): string {
  const days = weekDays(monday);
  return `${dayLabel(days[0])} – ${dayLabel(days[6])} ${days[6].slice(0, 4)}`;
}

/**
 * Substitute a week's values into one templated field of a week board.
 *
 * This is what makes a week board a board for *every* week: its filters,
 * mutations and colour rules are stored with `{{week}}`/`{{monday}}` still in
 * them, and are rendered on the way to the screen — never on the way to the
 * file. Errors are dropped rather than reported: an unknown placeholder is left
 * standing (see {@link renderTemplate}), so it shows up where it was written.
 */
export function renderWeek(text: string, monday: Date): string {
  return renderTemplate(text, weekVariables(monday)).text;
}
