import type { Task } from "../services/TasksIntegration";
import type { DateColumnConfig } from "../types/persistence";
import type { DateField } from "./dateFilter";
import {
  DATE_FIELD_TO_KEYWORD,
  DATE_KEYWORD_TO_FIELD,
  DEFAULT_DATE_FIELD,
} from "./dateFilter";
import type { KanbanColumnConfig } from "./statusColumns";
import { formatDate } from "./taskChips";

/**
 * Id of the catch-all column that collects tasks with no date in the board's
 * field. Stable (not derived from the field) so its fold state survives a
 * change of field.
 */
export const NO_DATE_COLUMN_ID = "__no-date__";

/** Title of the catch-all column. */
export const NO_DATE_COLUMN_TITLE = "No date";

/** The date fields a date board can be built on, in lifecycle order. */
export const DATE_FIELDS: DateField[] = [
  "createdDate",
  "startDate",
  "scheduledDate",
  "dueDate",
  "doneDate",
  "cancelledDate",
];

/** Display labels for {@link DATE_FIELDS}, for the settings dropdown. */
export const DATE_FIELD_LABELS: Record<DateField, string> = {
  createdDate: "Created date",
  startDate: "Start date",
  scheduledDate: "Scheduled date",
  dueDate: "Due date",
  doneDate: "Done date",
  cancelledDate: "Cancelled date",
};

/** The only date spelling a column accepts: an exact calendar day. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether `value` is a usable column date: an exact `YYYY-MM-DD` day that is a
 * real calendar date (so `2026-02-31` is rejected rather than silently rolling
 * over into March).
 */
export function isValidColumnDate(value: string): boolean {
  const trimmed = value.trim();
  if (!ISO_DATE.test(trimmed)) {
    return false;
  }
  const date = new Date(`${trimmed}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === trimmed
  );
}

/**
 * Today as `YYYY-MM-DD`, in the user's own calendar day — a new column should
 * mean the day they are looking at, not the UTC one.
 */
export function todayISO(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Coerce a persisted date-field value. Accepts both the internal field name
 * (`dueDate`) and the Tasks keyword a hand-written board file would use
 * (`due`); anything else falls back to {@link DEFAULT_DATE_FIELD}.
 */
export function resolveDateField(raw: unknown): DateField {
  if (typeof raw !== "string") {
    return DEFAULT_DATE_FIELD;
  }
  const trimmed = raw.trim();
  if ((DATE_FIELDS as string[]).includes(trimmed)) {
    return trimmed as DateField;
  }
  return DATE_KEYWORD_TO_FIELD[trimmed.toLowerCase()] ?? DEFAULT_DATE_FIELD;
}

/** The Tasks keyword for a field, used when writing a board file. */
export function dateFieldKeyword(field: DateField): string {
  return DATE_FIELD_TO_KEYWORD[field];
}

/**
 * The task's value for `field`, normalised to `YYYY-MM-DD`, or "" when the task
 * carries no such date. Normalising here means a cache that hands over a Date
 * or a Moment compares the same as one that hands over a plain string.
 */
export function taskDate(task: Task, field: DateField): string {
  return formatDate(task[field]) ?? "";
}

/**
 * Build a date board's columns: one per configured day, led — unless
 * `noDateColumn` says otherwise — by the catch-all that collects every task
 * without a date in `field`.
 *
 * Unlike tag columns, date columns are configured rather than discovered — a
 * board shows exactly the days its user asked for, which is what makes a task
 * whose date matches no column *hidden* rather than swept into a bucket.
 * Columns keep their configured order (there is no implicit chronological
 * sort), and a day that cannot be parsed, or repeats one already listed, is
 * dropped: it could neither match a task nor accept a drop unambiguously.
 *
 * The catch-all is worth turning off when the board already pools undated
 * tasks elsewhere — the weekly planner's "Unplanned" meta column collects the
 * undated work that matters, leaving "No date" holding only finished scraps.
 */
export function buildDateColumns(
  field: DateField,
  columns: DateColumnConfig[],
  noDateColumn = true,
): KanbanColumnConfig[] {
  const built: KanbanColumnConfig[] = [];

  if (noDateColumn) {
    built.push({
      id: NO_DATE_COLUMN_ID,
      title: NO_DATE_COLUMN_TITLE,
      symbols: [],
      dropSymbol: "",
      dateField: field,
      date: "",
    });
  }

  const seen = new Set<string>();
  for (const column of columns) {
    const date = column.date.trim();
    if (!isValidColumnDate(date) || seen.has(date)) {
      continue;
    }
    seen.add(date);
    built.push({
      id: column.id,
      title: column.title.trim() || date,
      symbols: [],
      dropSymbol: "",
      dateField: field,
      date,
    });
  }

  return built;
}
