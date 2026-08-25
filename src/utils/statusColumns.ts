import type { FilterInstruction } from "../query/boardQuery";
import type { StatusInfo } from "../services/TasksIntegration";
import type { ColumnConfig } from "../types/persistence";
import type { DateField } from "./dateFilter";
import type { MutationInstruction } from "./taskMutation";

/**
 * Configuration for a Kanban column at render time.
 *
 * A column partitions tasks one of four ways: three of them are the board's
 * type, the fourth is a meta column, which any board may also carry.
 *
 * - *status mode* (neither `tagPrefix` nor `dateField` set): a task belongs to
 *   the column whose {@link symbols} include its status symbol. Default columns
 *   (see {@link buildColumns}) group every symbol of a status type together;
 *   custom columns (see {@link resolveColumns}) are user-defined partitions.
 * - *tag mode* (`tagPrefix` set): a task belongs to the column whose {@link tag}
 *   it carries as `#<tagPrefix>_<tag>` (see buildTagColumns in tagColumns.ts).
 * - *date mode* (`dateField` set): a task belongs to the column whose
 *   {@link date} equals its value for that field (see buildDateColumns in
 *   dateColumns.ts).
 * - *meta mode* (`filters` set): a task belongs to the column when it satisfies
 *   the column's own filters, and dropping a card in applies the column's
 *   {@link mutation} (see buildMetaColumns in metaColumns.ts).
 *
 * Matching for all four modes lives in columnCollects (columnMatch.ts).
 */
export interface KanbanColumnConfig {
  id: string;
  title: string;
  /** Status symbols this column collects (status mode). */
  symbols: string[];
  /** Symbol written to the task when it is dropped into this column (status mode). */
  dropSymbol: string;
  color?: string;
  /** Tag mode: the board's shared column-tag prefix, without the leading '#'. */
  tagPrefix?: string;
  /** Tag mode: this column's part of the tag; "" marks the catch-all column. */
  tag?: string;
  /** Date mode: the board's date field, written on drop. */
  dateField?: DateField;
  /** Date mode: the day this column collects; "" marks the catch-all column. */
  date?: string;
  /** Meta mode: the filters a task must satisfy to land in this column. */
  filters?: FilterInstruction[];
  /** Meta mode: what is written to a task dropped into this column. */
  mutation?: MutationInstruction[];
}

/**
 * The order in which status-type columns are displayed.
 * NON_TASK is intentionally excluded.
 */
export const TYPE_ORDER = ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"] as const;

/**
 * Display labels for each supported status type.
 */
export const TYPE_LABELS: Record<string, string> = {
  TODO: "Todo",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

/**
 * Build Kanban columns from the vault's configured statuses.
 *
 * Statuses are grouped by type; one column is emitted per supported type that
 * has at least one configured status, in TYPE_ORDER. The first symbol of a type
 * (core statuses come before custom in the input order) becomes the dropSymbol.
 */
export function buildColumns(statuses: StatusInfo[]): KanbanColumnConfig[] {
  const symbolsByType = new Map<string, string[]>();

  for (const status of statuses) {
    if (!TYPE_LABELS[status.type]) {
      // Unsupported type (e.g. NON_TASK) — skip.
      continue;
    }
    const existing = symbolsByType.get(status.type);
    if (existing) {
      existing.push(status.symbol);
    } else {
      symbolsByType.set(status.type, [status.symbol]);
    }
  }

  const columns: KanbanColumnConfig[] = [];
  for (const type of TYPE_ORDER) {
    const symbols = symbolsByType.get(type);
    if (!symbols || symbols.length === 0) {
      continue;
    }
    columns.push({
      id: type.toLowerCase().replace(/_/g, "-"),
      title: TYPE_LABELS[type],
      symbols,
      dropSymbol: symbols[0],
    });
  }

  return columns;
}

/**
 * Resolve a board's persisted column configuration into the runtime columns to
 * render. With no custom columns this is the default status columns
 * ({@link buildColumns}); otherwise each {@link ColumnConfig} becomes a runtime
 * column whose drop symbol is its first symbol. Columns with no symbols are
 * dropped (they could neither match a task nor accept a drop).
 */
export function resolveColumns(
  custom: ColumnConfig[],
  statuses: StatusInfo[],
): KanbanColumnConfig[] {
  if (custom.length === 0) {
    return buildColumns(statuses);
  }
  return custom
    .filter((column) => column.symbols.length > 0)
    .map((column) => ({
      id: column.id,
      title: column.title,
      symbols: column.symbols,
      dropSymbol: column.symbols[0],
    }));
}
