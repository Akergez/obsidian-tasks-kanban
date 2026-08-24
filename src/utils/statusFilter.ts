import type { Task } from "../services/TasksIntegration";

/**
 * The six status types Tasks classifies every status symbol into.
 * See https://publish.obsidian.md/tasks/Getting+Started/Statuses/Status+Types
 */
export const STATUS_TYPES = [
  "TODO",
  "DONE",
  "IN_PROGRESS",
  "ON_HOLD",
  "CANCELLED",
  "NON_TASK",
] as const;

export type StatusType = (typeof STATUS_TYPES)[number];

/**
 * The types the bare `done` instruction matches, per the Tasks reference:
 * "done" covers DONE, CANCELLED and NON_TASK, while "not done" covers
 * TODO, IN_PROGRESS and ON_HOLD.
 *
 * We implement `not done` as the complement of this set rather than as its own
 * list, so the pair stays exhaustive: a task carrying an unrecognised type (a
 * future Tasks version, or a malformed cache entry) still lands in exactly one
 * of the two instead of vanishing from both.
 */
const DONE_TYPES = new Set<string>(["DONE", "CANCELLED", "NON_TASK"]);

/**
 * A parsed status filter line. Mirrors the Tasks status filters:
 *
 *   done
 *   not done
 *   status.type (is|is not) <TYPE>
 *   status.name (includes|does not include) <text>
 *   status.name (regex matches|regex does not match) /<pattern>/[flags]
 */
export interface StatusFilterInstruction {
  kind: "status";
  test: "done" | "type" | "name" | "name-regex";
  /** `status.type` value, `status.name` substring, or the regex source. */
  value?: string;
  /** Regex flags for the `name-regex` test (may be empty). */
  flags?: string;
  /** True for the negated spelling (`not done`, `is not`, `does not include`). */
  negated?: boolean;
}

/** Human-readable list of valid status types, for error messages. */
const TYPE_LIST = STATUS_TYPES.join("|");

/**
 * Parse one already-trimmed line as a status filter, or return null when it is
 * not one (the caller then tries the other filter kinds). A line that clearly
 * *is* a status filter but is malformed returns an `error` instead, so the user
 * gets a useful message rather than a generic "unsupported instruction".
 *
 * `done` and `not done` are matched only as whole lines: `done` is also a date
 * keyword (`done before 2026-01-01` is a doneDate filter), so anything with more
 * on the line must fall through to the date parser.
 */
export function parseStatusFilter(
  line: string,
): { filter: StatusFilterInstruction } | { error: string } | null {
  if (/^done$/i.test(line)) {
    return { filter: { kind: "status", test: "done" } };
  }
  if (/^not\s+done$/i.test(line)) {
    return { filter: { kind: "status", test: "done", negated: true } };
  }

  const typeMatch = /^status\.type\s+is(\s+not)?\s+(.+)$/i.exec(line);
  if (typeMatch) {
    const value = typeMatch[2].trim().toUpperCase();
    if (!(STATUS_TYPES as readonly string[]).includes(value)) {
      return {
        error: `unknown status type "${typeMatch[2].trim()}" (expected one of ${TYPE_LIST})`,
      };
    }
    return {
      filter: {
        kind: "status",
        test: "type",
        value,
        negated: Boolean(typeMatch[1]),
      },
    };
  }

  const regexMatch =
    /^status\.name\s+regex\s+(matches|does\s+not\s+match)\s+\/(.*)\/([a-z]*)$/i.exec(
      line,
    );
  if (regexMatch) {
    const pattern = regexMatch[2];
    const flags = regexMatch[3];
    try {
      new RegExp(pattern, flags);
    } catch {
      return { error: `invalid regular expression /${pattern}/${flags}` };
    }
    return {
      filter: {
        kind: "status",
        test: "name-regex",
        value: pattern,
        flags,
        negated: /does/i.test(regexMatch[1]),
      },
    };
  }

  const nameMatch =
    /^status\.name\s+(includes|does\s+not\s+include)\s+(.+)$/i.exec(line);
  if (nameMatch) {
    const value = nameMatch[2].trim();
    if (value === "") {
      return { error: "empty status name" };
    }
    return {
      filter: {
        kind: "status",
        test: "name",
        value,
        negated: /does/i.test(nameMatch[1]),
      },
    };
  }

  return null;
}

/** Serialize a status filter back to its canonical Tasks spelling. */
export function serializeStatusFilter(filter: StatusFilterInstruction): string {
  switch (filter.test) {
    case "done":
      return filter.negated ? "not done" : "done";
    case "type":
      return `status.type is${filter.negated ? " not" : ""} ${filter.value}`;
    case "name":
      return `status.name ${filter.negated ? "does not include" : "includes"} ${filter.value}`;
    case "name-regex":
      return `status.name regex ${filter.negated ? "does not match" : "matches"} /${filter.value}/${filter.flags ?? ""}`;
  }
}

/** Whether `task` satisfies a single status filter. */
export function matchesStatusFilter(
  task: Task,
  filter: StatusFilterInstruction,
): boolean {
  const { type = "", name = "" } = task.status ?? {};

  switch (filter.test) {
    case "done": {
      const isDone = DONE_TYPES.has(type.toUpperCase());
      return filter.negated ? !isDone : isDone;
    }
    case "type": {
      const matches = type.toUpperCase() === filter.value;
      return filter.negated ? !matches : matches;
    }
    case "name": {
      // Case-insensitive substring, matching Tasks' `status.name includes`.
      const matches = name
        .toLowerCase()
        .includes((filter.value ?? "").toLowerCase());
      return filter.negated ? !matches : matches;
    }
    case "name-regex": {
      // Case-sensitive unless the user supplied the `i` flag, as in Tasks.
      const matches = new RegExp(filter.value ?? "", filter.flags).test(name);
      return filter.negated ? !matches : matches;
    }
  }
}
