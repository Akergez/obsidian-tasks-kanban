import type { StatusInfo, Task } from "../services/TasksIntegration";
import { normalizeTag } from "./searchFilter";
import {
  DATE_FIELD_TO_KEYWORD,
  DATE_KEYWORD_TO_FIELD,
  type DateField,
} from "./dateFilter";
import {
  appendToTaskLine,
  FIELD_SYNTAX,
  setDateField,
  type TaskFormat,
} from "./taskFormat";

/**
 * What a drop into a meta column does to the task, written in the imperative
 * twin of the filter language: every instruction is the filter it makes true.
 *
 *   set done                     ↔ done
 *   set not done                 ↔ not done
 *   set status <symbol>          ↔ (a specific status symbol)
 *   set <date-field> <value>     ↔ <date-field> on <value>   (today|tomorrow|
 *                                  yesterday|YYYY-MM-DD)
 *   clear <date-field> date      ↔ no <date-field> date
 *   add tag #<tag>               ↔ tag includes #<tag>
 *   remove tag #<tag>            ↔ tag not includes #<tag>
 *
 * Instructions are applied to the task's line in the order written.
 */
export type MutationInstruction =
  | { kind: "status"; symbol: string }
  | { kind: "status-done"; done: boolean }
  | { kind: "date"; field: DateField; value: string }
  | { kind: "clear-date"; field: DateField }
  | { kind: "tag"; value: string; remove?: boolean };

/** One-line summary of the supported syntax, used in error messages. */
const SUPPORTED_SYNTAX =
  "supported: set done, set not done, set status <symbol>, " +
  "set <due|scheduled|start|created|done|cancelled> <today|tomorrow|yesterday|YYYY-MM-DD>, " +
  "clear <due|scheduled|start|created|done|cancelled> date, add tag #<tag>, remove tag #<tag>";

/** The relative days a `set <date-field>` instruction accepts. */
const RELATIVE_DAYS: Record<string, number> = {
  yesterday: -1,
  today: 0,
  tomorrow: 1,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse one already-trimmed mutation line, or return an error describing why it
 * is not one. Unlike the filter parser there is no "not mine" case: a mutation
 * block holds nothing but mutations.
 */
export function parseMutationLine(
  line: string,
): { mutation: MutationInstruction } | { error: string } {
  if (/^set\s+done$/i.test(line)) {
    return { mutation: { kind: "status-done", done: true } };
  }
  if (/^set\s+not\s+done$/i.test(line)) {
    return { mutation: { kind: "status-done", done: false } };
  }

  const statusMatch = /^set\s+status\s+(.+)$/i.exec(line);
  if (statusMatch) {
    // A status symbol is one character; `[x]` and `[ ]` are accepted too, since
    // that is how a symbol reads on the task line itself.
    const raw = statusMatch[1].trim();
    const bracketed = /^\[(.?)\]$/.exec(raw);
    const symbol = bracketed ? bracketed[1] || " " : raw;
    if (symbol.length !== 1) {
      return {
        error: `"${raw}" is not a status symbol (one character, e.g. x or /)`,
      };
    }
    return { mutation: { kind: "status", symbol } };
  }

  const clearMatch = /^clear\s+(\S+)(?:\s+date)?$/i.exec(line);
  if (clearMatch) {
    const field = DATE_KEYWORD_TO_FIELD[clearMatch[1].toLowerCase()];
    if (!field) {
      return {
        error: `unknown date field "${clearMatch[1]}" (${SUPPORTED_SYNTAX})`,
      };
    }
    return { mutation: { kind: "clear-date", field } };
  }

  const dateMatch = /^set\s+(\S+)\s+(?:date\s+)?(?:to\s+)?(.+)$/i.exec(line);
  if (dateMatch) {
    const field = DATE_KEYWORD_TO_FIELD[dateMatch[1].toLowerCase()];
    if (field) {
      const value = dateMatch[2].trim().toLowerCase();
      if (!(value in RELATIVE_DAYS) && !ISO_DATE.test(value)) {
        return {
          error: `"${dateMatch[2].trim()}" is not a day (use today, tomorrow, yesterday or YYYY-MM-DD)`,
        };
      }
      return { mutation: { kind: "date", field, value } };
    }
  }

  const tagMatch = /^(add|remove)\s+tag\s+(.+)$/i.exec(line);
  if (tagMatch) {
    const value = normalizeTag(tagMatch[2].trim());
    if (value === "") {
      return { error: "empty tag" };
    }
    return {
      mutation: {
        kind: "tag",
        value,
        remove: tagMatch[1].toLowerCase() === "remove",
      },
    };
  }

  return { error: `unsupported instruction "${line}" (${SUPPORTED_SYNTAX})` };
}

/**
 * Parse a multi-line mutation. Tolerant like the query parser: a bad line is
 * skipped and reported with its 1-based line number, so one typo does not
 * discard the rest of the mutation.
 */
export function parseMutation(input: string): {
  mutations: MutationInstruction[];
  errors: string[];
} {
  const mutations: MutationInstruction[] = [];
  const errors: string[] = [];

  input.split("\n").forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === "") {
      return;
    }
    const result = parseMutationLine(line);
    if ("error" in result) {
      errors.push(`Line ${index + 1}: ${result.error}`);
      return;
    }
    mutations.push(result.mutation);
  });

  return { mutations, errors };
}

/** Serialize one instruction back to its canonical spelling. */
export function serializeMutation(mutation: MutationInstruction): string {
  switch (mutation.kind) {
    case "status":
      return `set status ${mutation.symbol}`;
    case "status-done":
      return mutation.done ? "set done" : "set not done";
    case "date":
      return `set ${DATE_FIELD_TO_KEYWORD[mutation.field]} ${mutation.value}`;
    case "clear-date":
      return `clear ${DATE_FIELD_TO_KEYWORD[mutation.field]} date`;
    case "tag":
      return `${mutation.remove ? "remove" : "add"} tag #${mutation.value}`;
  }
}

/**
 * Everything applying a mutation needs from outside: the vault's statuses and
 * the Tasks plugin's write settings, plus the day "today" means.
 *
 * The statuses arrive as two lookups rather than a list, so a caller that only
 * changes a known symbol never has to enumerate them.
 */
export interface MutationContext {
  /** The status a symbol denotes, or undefined when the vault has none. */
  statusOf(symbol: string): StatusInfo | undefined;
  /**
   * The symbol to write for a status type — what `set done` and `set not done`
   * resolve to — or null when the vault configures no status of that type.
   */
  symbolForType(type: string): string | null;
  /** Which metadata syntax to write. */
  format: TaskFormat;
  /** Tasks' "set done date on completion" setting. */
  setDoneDate: boolean;
  /** Tasks' "set cancelled date on cancellation" setting. */
  setCancelledDate: boolean;
  /**
   * The day `today` means, as `YYYY-MM-DD`: what a done/cancelled date is
   * stamped with and what `today`/`tomorrow`/`yesterday` resolve against.
   * Passed in rather than read here, so the caller decides (and a test can).
   */
  today: string;
}

/**
 * Rewrite `line` (the task's own source line) by applying `mutations` in order.
 *
 * `task` supplies the status the line currently carries — the same value the
 * board matched on — so a status change knows what it is transitioning *from*
 * and can add or drop the done/cancelled date exactly as a status drop does.
 * Returns null when the line is not a task line, matching the convention of
 * TaskUpdater's other transforms.
 */
export function applyMutations(
  line: string,
  task: Task,
  mutations: MutationInstruction[],
  context: MutationContext,
): string | null {
  let updated = line;
  let currentSymbol = task.status.symbol;

  for (const mutation of mutations) {
    switch (mutation.kind) {
      case "status":
      case "status-done": {
        const symbol =
          mutation.kind === "status"
            ? mutation.symbol
            : context.symbolForType(mutation.done ? "DONE" : "TODO");
        if (symbol === null) {
          // No configured status of that type: leave the status alone rather
          // than writing a symbol the vault does not know.
          break;
        }
        const next = applyStatusChange(updated, currentSymbol, symbol, context);
        if (next === null) {
          return null;
        }
        updated = next;
        currentSymbol = symbol;
        break;
      }
      case "date":
        updated = setDateField(
          updated,
          mutation.field,
          resolveDay(mutation.value, context.today),
          context.format,
        );
        break;
      case "clear-date":
        updated = setDateField(updated, mutation.field, null, context.format);
        break;
      case "tag":
        updated = setTag(updated, mutation.value, mutation.remove === true);
        break;
    }
  }

  return updated;
}

/**
 * Rewrite the status symbol on a task line, keeping the done and cancelled
 * dates in step with the transition — the one place that rule lives, shared by
 * a status-column drop and a meta column's `set done` / `set not done`.
 *
 * Returns null when `line` is not a task line.
 */
export function applyStatusChange(
  line: string,
  currentSymbol: string,
  newSymbol: string,
  context: MutationContext,
): string | null {
  const match = line.match(/^(\s*- \[)[^\]]*(]\s*.*)$/);
  if (!match) {
    return null;
  }

  const syntax = FIELD_SYNTAX[context.format];
  const currentType = typeOfSymbol(currentSymbol, context);
  const newType = typeOfSymbol(newSymbol, context);
  const today = context.today;

  let updated = line.replace(
    `${match[1]}${currentSymbol}${match[2]}`,
    `${match[1]}${newSymbol}${match[2]}`,
  );

  // Done date: written when entering DONE, dropped when leaving it.
  if (newType === "DONE" && currentType !== "DONE") {
    if (context.setDoneDate) {
      // No $ anchor: see FieldSyntax.strip doc comment in taskFormat.ts.
      updated = updated.replace(syntax.doneDate.strip, "");
      updated = `${updated}${syntax.doneDate.render(today)}`;
    }
  } else if (currentType === "DONE" && newType !== "DONE") {
    updated = updated.replace(syntax.doneDate.strip, "");
  }

  // Cancelled date: the same rule, one field over.
  if (newType === "CANCELLED" && currentType !== "CANCELLED") {
    if (context.setCancelledDate) {
      updated = updated.replace(syntax.cancelledDate.strip, "");
      updated = `${updated}${syntax.cancelledDate.render(today)}`;
    }
  } else if (currentType === "CANCELLED" && newType !== "CANCELLED") {
    updated = updated.replace(syntax.cancelledDate.strip, "");
  }

  return updated;
}

/** The status type of a symbol, or undefined when the vault has no such status. */
function typeOfSymbol(
  symbol: string,
  context: MutationContext,
): string | undefined {
  return context.statusOf(symbol)?.type;
}

/**
 * Resolve a mutation's day value: an exact day is itself, a relative one is
 * counted off `today` (which the caller supplies, see {@link MutationContext}).
 */
function resolveDay(value: string, today: string): string {
  const offset = RELATIVE_DAYS[value];
  if (offset === undefined) {
    return value;
  }
  const [year, month, day] = today.split("-").map(Number);
  const shifted = new Date(year, month - 1, day + offset);
  return [
    shifted.getFullYear(),
    String(shifted.getMonth() + 1).padStart(2, "0"),
    String(shifted.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Add or remove a plain tag on a task line. Removing takes the whitespace that
 * introduced the tag with it; adding appends (in front of any trailing block
 * reference), and a tag already on the line is left where the user wrote it.
 */
function setTag(line: string, tag: string, remove: boolean): string {
  const pattern = new RegExp(
    String.raw`(^|\s)#${escapeForRegExp(tag)}(?=$|[\s#])`,
    "g",
  );
  const has = pattern.test(line);
  pattern.lastIndex = 0;

  if (remove) {
    return has ? line.replace(pattern, "").replace(/\s+$/, "") : line;
  }
  if (has) {
    return line;
  }
  return appendToTaskLine(line, ` #${tag}`);
}

/** Escape a tag for use inside a regular expression. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
