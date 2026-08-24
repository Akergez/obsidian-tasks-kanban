import { emptyBoardFile, type BoardFile } from "../query/boardFile";
import type { DateField } from "./dateFilter";
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
 * Sortable, unambiguous, and stable — it is the planner's identity, so opening
 * the planner twice in one week finds the same file rather than making another.
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
 * Build the weekly planner for the week starting at `monday`: a date board with
 * one column per weekday, named after the ISO week.
 *
 * Column ids are derived from the day rather than random, so the file is a pure
 * function of the week — regenerating it would produce the same document, and a
 * folded column keeps its identity.
 */
export function buildWeeklyBoard(
  monday: Date,
  dateField: DateField,
): BoardFile {
  const days = weekDays(monday);
  return {
    ...emptyBoardFile(isoWeekName(monday)),
    boardType: "date",
    dateField,
    dateColumns: days.map((date, index) => ({
      id: `date:${date}`,
      title: WEEKDAY_TITLES[index],
      date,
    })),
  };
}
