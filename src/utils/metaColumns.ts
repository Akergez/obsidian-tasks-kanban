import { parseFilterLines } from "../query/boardQuery";
import type { MetaColumnConfig } from "../types/persistence";
import type { KanbanColumnConfig } from "./statusColumns";
import { parseMutation } from "./taskMutation";

/** The title a meta column falls back to when it is left unnamed. */
export const UNNAMED_META_COLUMN_TITLE = "Meta";

/**
 * Build a board's meta columns from their configuration: the predicate becomes
 * the filters the column collects on, the mutation becomes what a drop writes.
 *
 * A column whose predicate holds no usable filter is dropped. An empty
 * predicate would collect *every* task — the whole board swept into one
 * column — so it is a misconfiguration rather than a wildcard; the board
 * settings flag it before it can be saved.
 */
export function buildMetaColumns(
  columns: MetaColumnConfig[],
): KanbanColumnConfig[] {
  const built: KanbanColumnConfig[] = [];

  for (const column of columns) {
    const { filters } = parseFilterLines(column.filter);
    if (filters.length === 0) {
      continue;
    }
    built.push({
      id: column.id,
      title: column.title.trim() || UNNAMED_META_COLUMN_TITLE,
      symbols: [],
      dropSymbol: "",
      filters,
      // A column may collect without mutating: dropping into it then simply
      // does nothing, which is a legitimate read-only pool.
      mutation: parseMutation(column.mutation).mutations,
    });
  }

  return built;
}

/**
 * Every error in a meta column's configuration, for the settings modal. Keeps
 * the messages in the same shape the query and colour-rule fields use, prefixed
 * with the column so a board with several says which one is broken.
 */
export function metaColumnErrors(columns: MetaColumnConfig[]): string[] {
  const errors: string[] = [];

  columns.forEach((column, index) => {
    const label = column.title.trim() || `Meta column ${index + 1}`;
    const filter = parseFilterLines(column.filter);
    for (const error of filter.errors) {
      errors.push(`${label}: ${error}`);
    }
    if (filter.errors.length === 0 && filter.filters.length === 0) {
      errors.push(`${label}: needs at least one filter line.`);
    }
    for (const error of parseMutation(column.mutation).errors) {
      errors.push(`${label}: ${error}`);
    }
  });

  return errors;
}
