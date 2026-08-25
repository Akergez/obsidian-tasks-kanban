import { emptyBoardFile, type BoardFile } from "../query/boardFile";
import { DATE_FIELD_TO_KEYWORD, type DateField } from "./dateFilter";
import { todayISO } from "./dateColumns";
import type { BoardActionConfig, MetaColumnConfig } from "../types/persistence";

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
 * A task's **preplanning tag**: `#w35_2026` says "this belongs to week 35 of
 * 2026" without committing it to a day. Written by hand in the note (or by a
 * meta column's `add tag` mutation), and read by the planner to keep other
 * weeks' work out of this week's pool.
 *
 * The week number is the ISO one — the same the planner names its file after —
 * and the year is the ISO week-year, so the tag for the week of 2027-01-01 is
 * `#w53_2026`, matching the board named `2026-W53`.
 */
export function weekTag(monday: Date): string {
  const [year, week] = isoWeekName(monday).split("-W");
  // Unpadded, as the tag is written by hand: `#w5_2026`, not `#w05_2026`.
  return `#w${Number(week)}_${year}`;
}

/**
 * Matches any preplanning tag, whatever week it names. A leading zero is
 * allowed so a hand-written `#w05_2026` counts as planned too.
 */
export const WEEK_TAG_PATTERN = String.raw`^#w\d+_\d{4}$`;

/** Matches this week's preplanning tag, padded or not. */
function weekTagPattern(monday: Date): string {
  const [year, week] = isoWeekName(monday).split("-W");
  return String.raw`^#w0*${Number(week)}_${year}$`;
}

/** The Monday after `monday` — the week this one hands work on to. */
function nextMonday(monday: Date): Date {
  return new Date(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + 7,
  );
}

/**
 * The planner's card actions: the three things one does to a task while
 * planning a week, offered on right-click.
 *
 * "Next week" is the one that needs saying carefully. Handing a task on means
 * taking it out of this week — clearing its day and dropping this week's
 * preplanning tag — before tagging it for the next, or the task would still be
 * claimed by this board (a day column keeps a dated card, and the pool keeps
 * one tagged for this week). The card therefore leaves the board, and turns up
 * in next week's planner, which is what "next week" should look like.
 */
export function weeklyActions(
  monday: Date,
  dateField: DateField,
): BoardActionConfig[] {
  const keyword = DATE_FIELD_TO_KEYWORD[dateField];
  return [
    {
      id: "action:next-week",
      title: "Next week",
      mutation: [
        `clear ${keyword} date`,
        `remove tag ${weekTag(monday)}`,
        `add tag ${weekTag(nextMonday(monday))}`,
      ].join("\n"),
    },
    {
      id: "action:cancel",
      title: "Cancel",
      mutation: "set status.type CANCELLED",
    },
    {
      id: "action:done",
      title: "Done",
      mutation: "set done",
    },
  ];
}

/** Title of the planner's meta column, the pool the week is planned out of. */
export const UNPLANNED_COLUMN_TITLE = "Unplanned";

/** Id of that column; derived from its meaning, like the day columns' ids. */
export const UNPLANNED_COLUMN_ID = "meta:unplanned";

/**
 * The planner's meta column: everything still to do that this week has not
 * caught — unfinished work with no day, or with a day older than the week.
 *
 * The threshold is the week's own Monday, not today: a board that planned the
 * whole week would otherwise empty its earlier days as the week went on,
 * pulling Monday's unfinished card out of Monday on Tuesday. The week is the
 * unit being planned, so the week is what the pool is outside of.
 *
 * Preplanning tags ({@link weekTag}) narrow it further: a task carrying some
 * other week's tag is already spoken for and stays out, while one tagged for
 * this week — or for no week at all — belongs in the pool. Said in the query
 * language rather than in code, so the rule is visible in the board file and
 * editable there.
 *
 * Its mutation is the exact undoing of a drop into a weekday: the task stops
 * being done and loses its day, so dragging a card back out of the week returns
 * it to the pool rather than leaving it dated in a week gone by.
 *
 * Both are written in the board's own language against the board's own date
 * field, so a planner built on `due` reads and writes due dates.
 */
export function unplannedColumn(
  monday: Date,
  dateField: DateField,
): MetaColumnConfig {
  const keyword = DATE_FIELD_TO_KEYWORD[dateField];
  const weekStart = todayISO(monday);
  return {
    id: UNPLANNED_COLUMN_ID,
    title: UNPLANNED_COLUMN_TITLE,
    filter: [
      "not done",
      `(no ${keyword} date) OR (${keyword} before ${weekStart})`,
      // Preplanning: a task tagged for some other week is that week's problem.
      `(tag regex matches /${weekTagPattern(monday)}/) OR NOT (tag regex matches /${WEEK_TAG_PATTERN}/)`,
    ].join("\n"),
    mutation: ["set not done", `clear ${keyword} date`].join("\n"),
  };
}

/**
 * Build the weekly planner for the week starting at `monday`: a date board with
 * one column per weekday, led by the {@link unplannedColumn} pool (and with no
 * "No date" catch-all, which that pool makes redundant), named after the ISO
 * week, with the {@link weeklyActions} on every card's right-click menu.
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
    metaColumns: [unplannedColumn(monday, dateField)],
    actions: weeklyActions(monday, dateField),
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
