import { parseYaml } from "obsidian";
import {
  DEFAULT_BOARD_TYPE,
  DEFAULT_NO_DATE_COLUMN,
  resolveBoardType,
  resolveNoDateColumn,
  type BoardType,
  type BoardActionConfig,
  type ColumnConfig,
  type DateColumnConfig,
  type MetaColumnConfig,
} from "../types/persistence";
import {
  dateFieldKeyword,
  isValidColumnDate,
  resolveDateField,
} from "../utils/dateColumns";
import { DEFAULT_DATE_FIELD, type DateField } from "../utils/dateFilter";

/** File extension that marks a board document. */
export const BOARD_EXTENSION = "kanban";

/**
 * A board as it lives on disk: everything about one board, including its fold
 * state. This is the whole file — there is no other place a board's own
 * settings are kept (the shared base query stays in the plugin's data.json).
 */
export interface BoardFile {
  /** Display name. Defaults to the file's base name when the key is absent. */
  name: string;
  /** Which kind of columns this board has. Always written, never inferred. */
  boardType: BoardType;
  /** The board's own query lines (filters + sort + group). */
  query: string;
  /** Tag-column prefix (tag boards). */
  columnTagPrefix: string;
  /** Tag-column order, comma-separated; "" ⇒ alphabetical. */
  columnOrder: string;
  /** The date field a date board's columns are days of. */
  dateField: DateField;
  /** The days a date board shows, in order. */
  dateColumns: DateColumnConfig[];
  /** Whether a date board leads with the "No date" catch-all column. */
  noDateColumn: boolean;
  /** Card-spine colour rules, one `<filter> -> <colour>` per line. */
  cardColors: string;
  /** Custom status-symbol columns; empty ⇒ default status columns. */
  columns: ColumnConfig[];
  /** Meta columns (predicate + mutation), shown before the type's columns. */
  metaColumns: MetaColumnConfig[];
  /** Named mutations offered in a card's right-click menu. */
  actions: BoardActionConfig[];
  /** Column ids currently folded. */
  collapsedColumns: string[];
  /** Group keys (swimlane keys) currently folded. */
  collapsedGroups: string[];
}

/** A board file with nothing configured, used as the parse baseline. */
export function emptyBoardFile(name: string): BoardFile {
  return {
    name,
    boardType: DEFAULT_BOARD_TYPE,
    query: "",
    columnTagPrefix: "",
    columnOrder: "",
    dateField: DEFAULT_DATE_FIELD,
    dateColumns: [],
    noDateColumn: DEFAULT_NO_DATE_COLUMN,
    cardColors: "",
    columns: [],
    metaColumns: [],
    actions: [],
    collapsedColumns: [],
    collapsedGroups: [],
  };
}

/**
 * Render a multi-line value as a YAML block scalar, so the query and colour
 * rules stay readable and hand-editable rather than collapsing into an escaped
 * one-liner. `|-` strips the trailing newline, keeping round-trips exact.
 */
function blockScalar(key: string, value: string, indent = ""): string {
  const body = value
    .split("\n")
    .map((line) => (line === "" ? "" : `${indent}  ${line}`))
    .join("\n");
  return `${indent}${key}: |-\n${body}`;
}

/** Quote a scalar only when YAML would otherwise misread it. */
function scalar(value: string): string {
  return /^[\w][\w .,/#-]*$/.test(value) ? value : JSON.stringify(value);
}

/** Render a list of plain strings, using flow style for the empty case. */
function stringList(key: string, values: string[]): string {
  if (values.length === 0) {
    return `${key}: []`;
  }
  return [`${key}:`, ...values.map((v) => `  - ${scalar(v)}`)].join("\n");
}

/**
 * Serialize a board to the YAML written to its `.kanban` file.
 *
 * Fields left at their default are omitted, so a simple board stays a short,
 * legible file. Written by hand rather than through stringifyYaml so the
 * multi-line fields are guaranteed to come out as block scalars.
 */
export function serializeBoardFile(board: BoardFile): string {
  // boardType is always written, even at its default: it is what the board *is*,
  // and a file that states it can never be read back as a different kind.
  const lines: string[] = [
    `name: ${scalar(board.name)}`,
    `boardType: ${board.boardType}`,
  ];

  if (board.columnTagPrefix !== "") {
    lines.push(`columnTagPrefix: ${scalar(board.columnTagPrefix)}`);
  }
  if (board.columnOrder !== "") {
    lines.push(`columnOrder: ${scalar(board.columnOrder)}`);
  }
  if (board.boardType === "date") {
    lines.push(`dateField: ${dateFieldKeyword(board.dateField)}`);
    // Written only when off: the catch-all is the default, and a file that says
    // nothing must keep reading as the board it was before the flag existed.
    if (!board.noDateColumn) {
      lines.push("noDateColumn: false");
    }
  }

  if (board.query !== "") {
    lines.push("", blockScalar("query", board.query));
  }
  if (board.cardColors !== "") {
    lines.push("", blockScalar("cardColors", board.cardColors));
  }

  if (board.columns.length > 0) {
    lines.push("", "columns:");
    for (const column of board.columns) {
      lines.push(`  - id: ${scalar(column.id)}`);
      lines.push(`    title: ${scalar(column.title)}`);
      lines.push(
        `    symbols: [${column.symbols.map((s) => JSON.stringify(s)).join(", ")}]`,
      );
    }
  }

  if (board.metaColumns.length > 0) {
    lines.push("", "metaColumns:");
    for (const column of board.metaColumns) {
      lines.push(`  - id: ${scalar(column.id)}`);
      lines.push(`    title: ${scalar(column.title)}`);
      // Block scalars again, and for the same reason as the query: a predicate
      // and a mutation are multi-line programs, and stay readable as such.
      lines.push(blockScalar("filter", column.filter, "    "));
      if (column.mutation !== "") {
        lines.push(blockScalar("mutation", column.mutation, "    "));
      }
    }
  }

  if (board.actions.length > 0) {
    lines.push("", "actions:");
    for (const action of board.actions) {
      lines.push(`  - id: ${scalar(action.id)}`);
      lines.push(`    title: ${scalar(action.title)}`);
      lines.push(blockScalar("mutation", action.mutation, "    "));
    }
  }

  if (board.dateColumns.length > 0) {
    lines.push("", "dateColumns:");
    for (const column of board.dateColumns) {
      lines.push(`  - id: ${scalar(column.id)}`);
      lines.push(`    title: ${scalar(column.title)}`);
      // Quoted on purpose: YAML would otherwise read a bare `2026-08-24` as a
      // timestamp and hand us back a Date.
      lines.push(`    date: ${JSON.stringify(column.date)}`);
    }
  }

  lines.push("");
  lines.push(stringList("collapsedColumns", board.collapsedColumns));
  lines.push(stringList("collapsedGroups", board.collapsedGroups));

  return `${lines.join("\n")}\n`;
}

/**
 * Coerce an unknown YAML value to a string, treating null/absent as "".
 * A number or boolean is spelled out (so `columnOrder: 2026` still reads), but
 * a mapping or list is dropped rather than stringified into "[object Object]".
 */
function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/** Coerce an unknown YAML value to a list of strings, dropping non-strings. */
function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Coerce a YAML value holding a day. A hand-written `date: 2026-08-24` is read
 * by YAML as a timestamp, so a Date is accepted and put back into `YYYY-MM-DD`
 * (its components are UTC midnight, so the ISO prefix is the day meant).
 */
function asDay(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? ""
      : value.toISOString().slice(0, 10);
  }
  return asString(value).trim();
}

/** Coerce the `dateColumns:` block, dropping entries with no usable day. */
function asDateColumns(value: unknown): DateColumnConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const columns: DateColumnConfig[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const date = asDay(entry.date);
    if (!isValidColumnDate(date)) {
      continue;
    }
    columns.push({
      id: asString(entry.id) || crypto.randomUUID(),
      title: asString(entry.title),
      date,
    });
  }
  return columns;
}

/**
 * Coerce the `metaColumns:` block. An entry with no filter is dropped: it could
 * collect nothing, and an empty predicate would otherwise read as "everything".
 */
function asMetaColumns(value: unknown): MetaColumnConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const columns: MetaColumnConfig[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const filter = asString(entry.filter).trim();
    if (filter === "") {
      continue;
    }
    columns.push({
      id: asString(entry.id) || crypto.randomUUID(),
      title: asString(entry.title),
      filter,
      mutation: asString(entry.mutation).trim(),
    });
  }
  return columns;
}

/**
 * Coerce the `actions:` block. An entry with no mutation is dropped: a menu
 * item that changes nothing is only a way to mislead.
 */
function asActions(value: unknown): BoardActionConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const actions: BoardActionConfig[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const mutation = asString(entry.mutation).trim();
    if (mutation === "") {
      continue;
    }
    actions.push({
      id: asString(entry.id) || crypto.randomUUID(),
      title: asString(entry.title),
      mutation,
    });
  }
  return actions;
}

/** Coerce the `columns:` block, dropping entries that could not render. */
function asColumns(value: unknown): ColumnConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const columns: ColumnConfig[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const symbols = asStringList(entry.symbols);
    if (symbols.length === 0) {
      continue;
    }
    columns.push({
      id: asString(entry.id) || crypto.randomUUID(),
      title: asString(entry.title),
      symbols,
    });
  }
  return columns;
}

/**
 * Parse a `.kanban` file's contents.
 *
 * Parsing is tolerant, like the query parser: a malformed document or an
 * unusable field falls back to its default and is reported in `errors`, so a
 * hand-edited file with one bad line still opens instead of failing shut.
 * `fallbackName` (the file's base name) is used when the document has no
 * `name:` key.
 */
export function parseBoardFile(
  content: string,
  fallbackName: string,
): { board: BoardFile; errors: string[] } {
  const board = emptyBoardFile(fallbackName);
  const errors: string[] = [];

  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { board, errors: [`Could not parse the board file: ${detail}`] };
  }

  if (parsed === null || parsed === undefined || content.trim() === "") {
    // An empty file is a valid empty board, not an error.
    return { board, errors };
  }

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      board,
      errors: ["The board file must be a YAML mapping of settings."],
    };
  }

  const doc = parsed as Record<string, unknown>;

  const name = asString(doc.name).trim();
  board.name = name === "" ? fallbackName : name;
  board.query = asString(doc.query);
  board.columnTagPrefix = asString(doc.columnTagPrefix).trim();
  board.columnOrder = asString(doc.columnOrder);
  board.boardType = resolveBoardType(doc.boardType, board.columnTagPrefix);
  board.dateField = resolveDateField(doc.dateField);
  board.dateColumns = asDateColumns(doc.dateColumns);
  board.noDateColumn = resolveNoDateColumn(doc.noDateColumn);
  board.cardColors = asString(doc.cardColors);
  board.columns = asColumns(doc.columns);
  board.metaColumns = asMetaColumns(doc.metaColumns);
  board.actions = asActions(doc.actions);
  board.collapsedColumns = asStringList(doc.collapsedColumns);
  board.collapsedGroups = asStringList(doc.collapsedGroups);

  if (doc.columns !== undefined && !Array.isArray(doc.columns)) {
    errors.push("`columns` must be a list; ignoring it.");
  }

  if (doc.dateColumns !== undefined && !Array.isArray(doc.dateColumns)) {
    errors.push("`dateColumns` must be a list; ignoring it.");
  }

  if (doc.metaColumns !== undefined && !Array.isArray(doc.metaColumns)) {
    errors.push("`metaColumns` must be a list; ignoring it.");
  }

  if (doc.actions !== undefined && !Array.isArray(doc.actions)) {
    errors.push("`actions` must be a list; ignoring it.");
  }

  return { board, errors };
}
