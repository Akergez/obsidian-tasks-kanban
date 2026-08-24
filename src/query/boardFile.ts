import { parseYaml } from "obsidian";
import type { ColumnConfig } from "../types/persistence";

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
  /** The board's own query lines (filters + sort + group). */
  query: string;
  /** Tag-column prefix; "" ⇒ status columns. */
  columnTagPrefix: string;
  /** Tag-column order, comma-separated; "" ⇒ alphabetical. */
  columnOrder: string;
  /** Card-spine colour rules, one `<filter> -> <colour>` per line. */
  cardColors: string;
  /** Custom status-symbol columns; empty ⇒ default status columns. */
  columns: ColumnConfig[];
  /** Column ids currently folded. */
  collapsedColumns: string[];
  /** Group keys (swimlane keys) currently folded. */
  collapsedGroups: string[];
}

/** A board file with nothing configured, used as the parse baseline. */
export function emptyBoardFile(name: string): BoardFile {
  return {
    name,
    query: "",
    columnTagPrefix: "",
    columnOrder: "",
    cardColors: "",
    columns: [],
    collapsedColumns: [],
    collapsedGroups: [],
  };
}

/**
 * Render a multi-line value as a YAML block scalar, so the query and colour
 * rules stay readable and hand-editable rather than collapsing into an escaped
 * one-liner. `|-` strips the trailing newline, keeping round-trips exact.
 */
function blockScalar(key: string, value: string): string {
  const body = value
    .split("\n")
    .map((line) => (line === "" ? "" : `  ${line}`))
    .join("\n");
  return `${key}: |-\n${body}`;
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
  const lines: string[] = [`name: ${scalar(board.name)}`];

  if (board.columnTagPrefix !== "") {
    lines.push(`columnTagPrefix: ${scalar(board.columnTagPrefix)}`);
  }
  if (board.columnOrder !== "") {
    lines.push(`columnOrder: ${scalar(board.columnOrder)}`);
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
  board.cardColors = asString(doc.cardColors);
  board.columns = asColumns(doc.columns);
  board.collapsedColumns = asStringList(doc.collapsedColumns);
  board.collapsedGroups = asStringList(doc.collapsedGroups);

  if (doc.columns !== undefined && !Array.isArray(doc.columns)) {
    errors.push("`columns` must be a list; ignoring it.");
  }

  return { board, errors };
}
