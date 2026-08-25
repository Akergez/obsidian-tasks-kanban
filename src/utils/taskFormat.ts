import type { DateField } from "./dateFilter";

/**
 * The Tasks plugin's "Task Format" setting, which decides whether task
 * metadata is written as emoji (`✅ 2026-08-04`) or as Dataview inline fields
 * (`[completion:: 2026-08-04]`).
 */
export type TaskFormat = "tasksPluginEmoji" | "dataview";

/** Matches the Tasks plugin's own default. */
export const DEFAULT_TASK_FORMAT: TaskFormat = "tasksPluginEmoji";

/**
 * This plugin's own format setting. `auto` reads the format out of the Tasks
 * plugin's settings (the historical behaviour); the two concrete values pin it,
 * for a vault where that reading is wrong or unavailable.
 */
export type TaskFormatSetting = "auto" | TaskFormat;

/** Follow the Tasks plugin unless the user says otherwise. */
export const DEFAULT_TASK_FORMAT_SETTING: TaskFormatSetting = "auto";

/**
 * The task fields this plugin writes. Every Tasks date field is writable: the
 * done/cancelled dates follow a status change, the rest are written by dropping
 * a card into a column of a date board (see utils/dateColumns).
 */
export type WritableDateField = DateField;

export interface FieldSyntax {
  /** Render the field as a suffix to append to a task line. */
  render(date: string): string;
  /**
   * Match every existing occurrence of this field written in THIS format.
   *
   * Deliberately asymmetric with `render`: we write only the form Tasks'
   * serializer writes, but we must match every form Tasks' parser accepts,
   * or a hand-written variant would survive and we would append a duplicate.
   *
   * Global and unanchored on purpose — a line can carry both a done and a
   * cancelled date, in either order, so neither can be pinned to the end.
   */
  strip: RegExp;
}

/** The date part of every field, in both formats. */
const DATE = String.raw`\d{4}-\d{2}-\d{2}`;

/**
 * Every emoji Tasks' parser accepts for a field. The first is the one Tasks'
 * serializer writes, so it is the one we render.
 */
const FIELD_EMOJI: Record<WritableDateField, string[]> = {
  createdDate: ["➕"],
  startDate: ["🛫"],
  scheduledDate: ["⏳", "⌛"],
  dueDate: ["📅", "📆", "🗓"],
  doneDate: ["✅"],
  cancelledDate: ["❌"],
};

/** The Dataview inline-field key Tasks uses for each field. */
const FIELD_DATAVIEW_KEY: Record<WritableDateField, string> = {
  createdDate: "created",
  startDate: "start",
  scheduledDate: "scheduled",
  dueDate: "due",
  doneDate: "completion",
  cancelledDate: "cancelled",
};

/**
 * Build the strip regex for an emoji field, accepting every emoji spelling of
 * it and an optional variation selector (`🗓️` is `🗓` + U+FE0F, and either
 * form may be sitting in a note).
 */
function emojiStrip(emoji: string[]): RegExp {
  return new RegExp(
    String.raw`\s*(?:${emoji.join("|")})\uFE0F?\s*${DATE}`,
    "gu",
  );
}

/**
 * Build the strip regex for a Dataview inline field, covering the bracket and
 * paren forms, loose inner whitespace, and the optional trailing comma that
 * Tasks emits as a workaround in some layouts.
 */
function dataviewStrip(key: string): RegExp {
  return new RegExp(
    String.raw`\s*(?:\[\s*${key}::\s*${DATE}\s*\]|\(\s*${key}::\s*${DATE}\s*\)) *,?`,
    "g",
  );
}

/** Build one format's whole field table from the per-field tokens above. */
function buildSyntax(
  format: TaskFormat,
): Record<WritableDateField, FieldSyntax> {
  const fields = Object.keys(FIELD_EMOJI) as WritableDateField[];
  const table = {} as Record<WritableDateField, FieldSyntax>;
  for (const field of fields) {
    if (format === "dataview") {
      const key = FIELD_DATAVIEW_KEY[field];
      table[field] = {
        // Two leading spaces are required: a single space triggers the inline
        // field rendering bug (obsidian-tasks#1913).
        render: (date) => `  [${key}:: ${date}]`,
        strip: dataviewStrip(key),
      };
    } else {
      const emoji = FIELD_EMOJI[field];
      table[field] = {
        render: (date) => ` ${emoji[0]} ${date}`,
        strip: emojiStrip(emoji),
      };
    }
  }
  return table;
}

export const FIELD_SYNTAX: Record<
  TaskFormat,
  Record<WritableDateField, FieldSyntax>
> = {
  tasksPluginEmoji: buildSyntax("tasksPluginEmoji"),
  dataview: buildSyntax("dataview"),
};

/**
 * A block reference (`^my-id`) at the very end of a task line. Obsidian only
 * recognises it there, so any field we append has to go in front of it.
 */
const TRAILING_BLOCK_ID = /\s+\^[A-Za-z0-9-]+\s*$/;

/**
 * Append `suffix` to a task line, keeping it in front of any trailing block
 * reference — Obsidian only recognises `^id` at the very end of the line.
 */
export function appendToTaskLine(line: string, suffix: string): string {
  const trimmed = line.replace(/\s+$/, "");
  const blockId = TRAILING_BLOCK_ID.exec(trimmed);
  if (blockId) {
    const head = trimmed.slice(0, blockId.index);
    return `${head}${suffix}${blockId[0].replace(/\s+$/, "")}`;
  }
  return `${trimmed}${suffix}`;
}

/**
 * Rewrite `line` so it carries exactly one occurrence of `field` holding
 * `date`, or none when `date` is null.
 *
 * Existing occurrences written in `format` are stripped first, so a re-drop
 * replaces rather than duplicates. Occurrences written in the *other* format
 * are left alone: Tasks would not have parsed them as dates either, which makes
 * them the user's own description text.
 */
export function setDateField(
  line: string,
  field: WritableDateField,
  date: string | null,
  format: TaskFormat,
): string {
  const syntax = FIELD_SYNTAX[format][field];
  const stripped = line.replace(syntax.strip, "").replace(/\s+$/, "");

  if (date === null) {
    return stripped;
  }

  return appendToTaskLine(stripped, syntax.render(date));
}

/**
 * Coerce an unknown settings value to a supported format. Anything
 * unrecognised — including a format added by a future Tasks release — falls
 * back to emoji, which is Tasks' own default and this plugin's prior
 * behaviour.
 */
export function resolveTaskFormat(raw: unknown): TaskFormat {
  return raw === "dataview" ? "dataview" : DEFAULT_TASK_FORMAT;
}

/**
 * Coerce a persisted value to this plugin's format setting. Anything
 * unrecognised falls back to `auto`, i.e. keep following the Tasks plugin.
 */
export function resolveTaskFormatSetting(raw: unknown): TaskFormatSetting {
  if (raw === "dataview" || raw === "tasksPluginEmoji") {
    return raw;
  }
  return DEFAULT_TASK_FORMAT_SETTING;
}
