import { emptyBoardFile, type BoardFile } from "../query/boardFile";
import { DATE_FIELD_TO_KEYWORD, type DateField } from "./dateFilter";
import { todayISO } from "./dateColumns";
import type { MetaColumnConfig } from "../types/persistence";

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

/** Title of the planner's meta column, the pool the week is planned out of. */
export const UNPLANNED_COLUMN_TITLE = "Unplanned";

/** Id of that column; derived from its meaning, like the day columns' ids. */
export const UNPLANNED_COLUMN_ID = "meta:unplanned";

/**
 * The planner's meta column: everything still to do that the week has not
 * caught — unfinished work with no day, or with a day already gone.
 *
 * Its mutation is the exact undoing of a drop into a weekday: the task stops
 * being done and loses its day, so dragging a card back out of the week returns
 * it to the pool it came from rather than leaving it dated in the past.
 *
 * Both are written in the board's own language against the board's own date
 * field, so a planner built on `due` reads and writes due dates.
 */
export function unplannedColumn(dateField: DateField): MetaColumnConfig {
  const keyword = DATE_FIELD_TO_KEYWORD[dateField];
  return {
    id: UNPLANNED_COLUMN_ID,
    title: UNPLANNED_COLUMN_TITLE,
    filter: [
      "not done",
      `(no ${keyword} date) OR (${keyword} before today)`,
    ].join("\n"),
    mutation: ["set not done", `clear ${keyword} date`].join("\n"),
  };
}

/**
 * Build the weekly planner for the week starting at `monday`: a date board with
 * one column per weekday, led by the {@link unplannedColumn} pool (and with no
 * "No date" catch-all, which that pool makes redundant), named after the ISO
 * week.
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
    metaColumns: [unplannedColumn(dateField)],
    // The pool already holds the undated work worth seeing, so a "No date"
    // column would add nothing but finished leftovers.
    noDateColumn: false,
    dateColumns: days.map((date, index) => ({
      id: `date:${date}`,
      title: WEEKDAY_TITLES[index],
      date,
    })),
  };
}
