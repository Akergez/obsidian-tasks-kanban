import type { Task } from "../services/TasksIntegration";
import { folderOf } from "./taskFile";

/**
 * The file-location fields a task can be filtered on, matching the Tasks
 * reference (https://publish.obsidian.md/tasks/Queries/Filters):
 *
 * - `path`     — full path from the vault root, including the file name and `.md`
 * - `filename` — file name alone, also including `.md`
 * - `folder`   — the containing directory; `/` for a file at the vault root
 */
export const LOCATION_FIELDS = ["path", "filename", "folder"] as const;

export type LocationField = (typeof LOCATION_FIELDS)[number];

/**
 * A parsed file-location filter line:
 *
 *   <field> (includes|does not include) <text>
 *   <field> (regex matches|regex does not match) /<pattern>/[flags]
 */
export interface LocationFilterInstruction {
  kind: "location";
  field: LocationField;
  /** Substring to look for, or the regex source for the `regex` test. */
  value: string;
  /** Present only for the regex test; distinguishes it from `includes`. */
  flags?: string;
  /** True for the negated spelling (`does not include`, `regex does not match`). */
  negated?: boolean;
  /** Which comparison to run. */
  test: "includes" | "regex";
}

const FIELD_PATTERN = LOCATION_FIELDS.join("|");

/**
 * Parse one already-trimmed line as a file-location filter, or return null when
 * it is not one. A line naming a location field but malformed in some other way
 * returns an `error`, so the user sees why rather than a generic message.
 */
export function parseLocationFilter(
  line: string,
): { filter: LocationFilterInstruction } | { error: string } | null {
  const regexMatch = new RegExp(
    `^(${FIELD_PATTERN})\\s+regex\\s+(matches|does\\s+not\\s+match)\\s+/(.*)/([a-z]*)$`,
    "i",
  ).exec(line);
  if (regexMatch) {
    const pattern = regexMatch[3];
    const flags = regexMatch[4];
    try {
      new RegExp(pattern, flags);
    } catch {
      return { error: `invalid regular expression /${pattern}/${flags}` };
    }
    return {
      filter: {
        kind: "location",
        field: regexMatch[1].toLowerCase() as LocationField,
        test: "regex",
        value: pattern,
        flags,
        negated: /does/i.test(regexMatch[2]),
      },
    };
  }

  const includesMatch = new RegExp(
    `^(${FIELD_PATTERN})\\s+(includes|does\\s+not\\s+include)\\s+(.+)$`,
    "i",
  ).exec(line);
  if (includesMatch) {
    const value = includesMatch[3].trim();
    if (value === "") {
      return { error: `empty ${includesMatch[1].toLowerCase()}` };
    }
    return {
      filter: {
        kind: "location",
        field: includesMatch[1].toLowerCase() as LocationField,
        test: "includes",
        value,
        negated: /does/i.test(includesMatch[2]),
      },
    };
  }

  return null;
}

/** Serialize a location filter back to its canonical Tasks spelling. */
export function serializeLocationFilter(
  filter: LocationFilterInstruction,
): string {
  if (filter.test === "regex") {
    const verb = filter.negated ? "regex does not match" : "regex matches";
    return `${filter.field} ${verb} /${filter.value}/${filter.flags ?? ""}`;
  }
  const verb = filter.negated ? "does not include" : "includes";
  return `${filter.field} ${verb} ${filter.value}`;
}

/**
 * The string a location filter compares against.
 *
 * Note both `path` and `filename` keep the `.md` extension, as Tasks does — this
 * deliberately differs from fileNameOf in taskFile.ts, which strips it because
 * it feeds display, grouping and sorting rather than matching.
 */
export function locationValue(task: Task, field: LocationField): string {
  const path = task.taskLocation?.path ?? "";
  if (path === "") {
    return "";
  }
  switch (field) {
    case "path":
      return path;
    case "filename":
      return path.slice(path.lastIndexOf("/") + 1);
    case "folder":
      return folderOf(path);
  }
}

/** Whether `task` satisfies a single location filter. */
export function matchesLocationFilter(
  task: Task,
  filter: LocationFilterInstruction,
): boolean {
  const subject = locationValue(task, filter.field);

  const matches =
    filter.test === "regex"
      ? new RegExp(filter.value, filter.flags).test(subject)
      : // `includes` is case-insensitive in Tasks; the regex form is not.
        subject.toLowerCase().includes(filter.value.toLowerCase());

  return filter.negated ? !matches : matches;
}
