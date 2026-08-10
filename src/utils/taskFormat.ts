/**
 * The Tasks plugin's "Task Format" setting, which decides whether task
 * metadata is written as emoji (`✅ 2026-08-04`) or as Dataview inline fields
 * (`[completion:: 2026-08-04]`).
 */
export type TaskFormat = "tasksPluginEmoji" | "dataview";

/** Matches the Tasks plugin's own default. */
export const DEFAULT_TASK_FORMAT: TaskFormat = "tasksPluginEmoji";

/** The task fields this plugin writes. */
export type WritableDateField = "doneDate" | "cancelledDate";

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

/**
 * Build the strip regex for a Dataview inline field, covering the bracket and
 * paren forms, loose inner whitespace, and the optional trailing comma that
 * Tasks emits as a workaround in some layouts.
 */
function dataviewStrip(key: string): RegExp {
  const date = String.raw`\d{4}-\d{2}-\d{2}`;
  return new RegExp(
    String.raw`\s*(?:\[\s*${key}::\s*${date}\s*\]|\(\s*${key}::\s*${date}\s*\)) *,?`,
    "g",
  );
}

export const FIELD_SYNTAX: Record<
  TaskFormat,
  Record<WritableDateField, FieldSyntax>
> = {
  tasksPluginEmoji: {
    doneDate: {
      render: (date) => ` ✅ ${date}`,
      strip: /\s*✅\s*\d{4}-\d{2}-\d{2}/g,
    },
    cancelledDate: {
      render: (date) => ` ❌ ${date}`,
      strip: /\s*❌\s*\d{4}-\d{2}-\d{2}/g,
    },
  },
  dataview: {
    doneDate: {
      // Two leading spaces are required: a single space triggers the inline
      // field rendering bug (obsidian-tasks#1913).
      render: (date) => `  [completion:: ${date}]`,
      strip: dataviewStrip("completion"),
    },
    cancelledDate: {
      render: (date) => `  [cancelled:: ${date}]`,
      strip: dataviewStrip("cancelled"),
    },
  },
};

/**
 * Coerce an unknown settings value to a supported format. Anything
 * unrecognised — including a format added by a future Tasks release — falls
 * back to emoji, which is Tasks' own default and this plugin's prior
 * behaviour.
 */
export function resolveTaskFormat(raw: unknown): TaskFormat {
  return raw === "dataview" ? "dataview" : DEFAULT_TASK_FORMAT;
}
