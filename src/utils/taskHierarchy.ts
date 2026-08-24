import type { Task } from "../services/TasksIntegration";

/** How many spaces a tab counts for when measuring indentation. */
const TAB_WIDTH = 4;

/**
 * A task nested under a card's root task, with how deep it sits below that root
 * (1 for a direct child, 2 for a child of a child, and so on).
 */
export interface SubTask {
  task: Task;
  depth: number;
}

/**
 * The board's tasks split into the ones that get their own card and the ones
 * that ride along inside a card.
 */
export interface NestedTasks {
  /** Top-level tasks — one card each. */
  roots: Task[];
  /** Descendants of each root, in document order, keyed by {@link taskKey}. */
  subTasksOf: Map<string, SubTask[]>;
}

/**
 * A task's stable identity for nesting lookups: its position in the vault. Ids
 * and markdown text can both change under us (see removeDuplicateTasks), but a
 * physical line is a physical line.
 */
export function taskKey(task: Task): string {
  const location = task.taskLocation;
  return location ? `${location.path}:${location.lineNumber}` : "";
}

/**
 * The indentation width of a task's source line, with tabs counted as
 * {@link TAB_WIDTH} spaces so mixed indentation still nests sensibly.
 */
export function indentOf(task: Task): number {
  const leading = /^[ \t]*/.exec(task.originalMarkdown ?? "")?.[0] ?? "";
  let width = 0;
  for (const char of leading) {
    width += char === "\t" ? TAB_WIDTH : 1;
  }
  return width;
}

/**
 * Split tasks into root tasks and the sub-tasks belonging to each.
 *
 * Nesting is read off the source lines: within one file, a task is nested under
 * the closest preceding task with a smaller indent. Every descendant — however
 * deep — is attached to its *top-level* ancestor, because that is the task that
 * owns the card; `depth` is kept so the card can indent them visually.
 *
 * Tasks in different files never nest, and a task with no location cannot be
 * placed in the document order, so it is always its own root.
 *
 * The input order is not assumed: tasks are read in line order per file, and
 * `roots` comes back in the order the caller supplied so an already-applied
 * sort survives.
 */
export function nestTasks(tasks: Task[]): NestedTasks {
  const byFile = new Map<string, Task[]>();
  const rootKeys = new Set<string>();
  const subTasksOf = new Map<string, SubTask[]>();

  for (const task of tasks) {
    const path = task.taskLocation?.path;
    if (!path) {
      continue;
    }
    const file = byFile.get(path);
    if (file) {
      file.push(task);
    } else {
      byFile.set(path, [task]);
    }
  }

  for (const file of byFile.values()) {
    file.sort(
      (a, b) =>
        (a.taskLocation?.lineNumber ?? 0) - (b.taskLocation?.lineNumber ?? 0),
    );

    // Indents of the open ancestors, outermost first. Its length is the depth.
    const openIndents: number[] = [];
    let rootKey = "";

    for (const task of file) {
      const indent = indentOf(task);
      while (
        openIndents.length > 0 &&
        openIndents[openIndents.length - 1] >= indent
      ) {
        openIndents.pop();
      }

      if (openIndents.length === 0) {
        rootKey = taskKey(task);
        rootKeys.add(rootKey);
      } else {
        const siblings = subTasksOf.get(rootKey);
        const entry = { task, depth: openIndents.length };
        if (siblings) {
          siblings.push(entry);
        } else {
          subTasksOf.set(rootKey, [entry]);
        }
      }

      openIndents.push(indent);
    }
  }

  // Preserve the caller's ordering for the cards themselves.
  const roots = tasks.filter(
    (task) => !task.taskLocation || rootKeys.has(taskKey(task)),
  );

  return { roots, subTasksOf };
}
