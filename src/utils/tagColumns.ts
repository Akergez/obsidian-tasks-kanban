import type { Task } from "../services/TasksIntegration";
import { normalizeTag } from "./searchFilter";
import type { KanbanColumnConfig } from "./statusColumns";

/**
 * Id of the catch-all column that collects tasks carrying no column tag.
 * Stable (not derived from the prefix) so its fold state survives a rename.
 */
export const NO_COLUMN_ID = "__no-column__";

/** Title of the catch-all column. */
export const NO_COLUMN_TITLE = "No column";

/**
 * Characters Obsidian allows in a tag body after the prefix. Used to carve the
 * column part out of `#<prefix>_<column>`.
 */
const TAG_BODY = "[^\\s#]+";

/** Escape a user-provided prefix for embedding in a RegExp. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A RegExp matching a whole column tag (`#<prefix>_<column>`) preceded by a
 * start-of-line or whitespace boundary, capturing that boundary as group 1 and
 * the column part as group 2. Global — a task line may carry several.
 */
export function columnTagPattern(prefix: string): RegExp {
  return new RegExp(`(^|\\s)#${escapeRegExp(prefix)}_(${TAG_BODY})`, "g");
}

/**
 * The column part of a normalised (no leading '#') tag belonging to `prefix`,
 * or null when the tag is not a column tag for this board.
 */
export function columnPart(tag: string, prefix: string): string | null {
  const marker = `${prefix}_`;
  if (!tag.startsWith(marker) || tag.length === marker.length) {
    return null;
  }
  return tag.slice(marker.length);
}

/** The column parts a task carries for `prefix`, normalised and deduplicated. */
export function columnPartsOf(task: Task, prefix: string): string[] {
  const parts: string[] = [];
  for (const tag of task.tags ?? []) {
    const part = columnPart(normalizeTag(tag), prefix);
    if (part !== null && !parts.includes(part)) {
      parts.push(part);
    }
  }
  return parts;
}

/**
 * Turn a column part into a header title: `in_progress` → "In progress".
 */
function titleFor(part: string): string {
  const words = part.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Parse the user's comma-separated column order into column parts.
 *
 * Entries are forgiving: `todo`, `#sprint_todo` and `sprint_todo` all name the
 * same column, so pasting a tag straight from a note works. Blanks are dropped
 * and duplicates collapse to their first mention.
 */
export function parseColumnOrder(value: string, prefix: string): string[] {
  const parts: string[] = [];
  for (const entry of value.split(",")) {
    const trimmed = normalizeTag(entry.trim());
    const part = columnPart(trimmed, prefix) ?? trimmed;
    if (part && !parts.includes(part)) {
      parts.push(part);
    }
  }
  return parts;
}

/**
 * Build the board's columns from the `#<prefix>_<column>` tags the tasks carry.
 *
 * Columns are discovered rather than configured: every distinct column part
 * found becomes a column. `order` (see {@link parseColumnOrder}) puts the parts
 * it names first, in the order given; anything it does not name follows
 * alphabetically, so an unlisted column lands somewhere stable rather than
 * jumping around as tasks move. The catch-all {@link NO_COLUMN_ID} column always
 * comes first and holds every task without a column tag for this prefix.
 *
 * An ordered part with no matching tag still gets a column — that is how an
 * empty column stays on the board for cards to be dropped into.
 */
export function buildTagColumns(
  tasks: Task[],
  prefix: string,
  order: string[] = [],
): KanbanColumnConfig[] {
  const parts = new Set<string>(order);
  for (const task of tasks) {
    for (const part of columnPartsOf(task, prefix)) {
      parts.add(part);
    }
  }

  const columns: KanbanColumnConfig[] = [
    {
      id: NO_COLUMN_ID,
      title: NO_COLUMN_TITLE,
      symbols: [],
      dropSymbol: "",
      tagPrefix: prefix,
      tag: "",
    },
  ];

  const rank = (part: string) => {
    const index = order.indexOf(part);
    return index === -1 ? order.length : index;
  };

  for (const part of [...parts].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.localeCompare(b, undefined, { sensitivity: "base" }),
  )) {
    columns.push({
      id: `tag:${prefix}_${part}`,
      title: titleFor(part),
      symbols: [],
      dropSymbol: "",
      tagPrefix: prefix,
      tag: part,
    });
  }

  return columns;
}

/**
 * Rewrite a task line so it carries exactly the column tag `part` for `prefix`
 * (or none, when `part` is ""). The first existing column tag is replaced in
 * place — keeping the tag where the user wrote it — and any further ones are
 * dropped; a line with no column tag gets the new one appended.
 */
export function setColumnTag(
  line: string,
  prefix: string,
  part: string,
): string {
  const newTag = part === "" ? "" : `#${prefix}_${part}`;
  let replaced = false;

  let updated = line.replace(
    columnTagPattern(prefix),
    (_match, lead: string) => {
      if (newTag && !replaced) {
        replaced = true;
        return `${lead}${newTag}`;
      }
      // Drop this tag along with the whitespace that introduced it.
      return "";
    },
  );

  if (newTag && !replaced) {
    updated = `${updated.replace(/\s+$/, "")} ${newTag}`;
  }

  return updated.replace(/\s+$/, "");
}
