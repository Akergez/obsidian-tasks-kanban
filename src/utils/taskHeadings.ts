import type { App, TFile } from "obsidian";
import type { Task } from "../services/TasksIntegration";

/**
 * One heading of a note, reduced to what placing a task under it needs: its
 * text, its depth, and the line it is on.
 *
 * This is the shape Obsidian's metadata cache hands over (`HeadingCache`),
 * flattened so the rule below can be tested without a vault.
 */
export interface HeadingRef {
  /** The heading's text, without its `#`s. */
  heading: string;
  /** 1 for `#`, 2 for `##`, and so on. */
  level: number;
  /** The line the heading is written on. */
  line: number;
}

/**
 * The headings a task sits under, outermost first — its place in the note.
 *
 * Not simply "every heading before it": a task under `## Tuesday` in
 * `# Week / ## Monday / ## Tuesday` belongs to Monday no more than it belongs
 * to a section of another note. So the trail is walked backwards from the task,
 * keeping a heading only when it is *shallower* than the last one kept, which
 * is exactly the chain of sections containing that line.
 *
 * Levels may skip (`#` straight to `###`) and repeat; both come out right,
 * because depth is compared rather than counted.
 */
export function headingTrail(headings: HeadingRef[], line: number): string[] {
  const trail: string[] = [];
  let depth = Number.MAX_SAFE_INTEGER;

  // Backwards from the task: the first heading above it is its own section,
  // and each shallower one after that is a section wrapping that.
  for (let i = headings.length - 1; i >= 0; i -= 1) {
    const heading = headings[i];
    if (heading.line >= line || heading.level >= depth) {
      continue;
    }
    depth = heading.level;
    trail.unshift(heading.heading.trim());
  }

  return trail.filter((heading) => heading !== "");
}

/**
 * The headings above a task in its own note, outermost first.
 *
 * Read from Obsidian's metadata cache rather than from the Tasks plugin, which
 * records only the *nearest* heading: a card says where a task lives, and one
 * level of that is rarely where it lives. An empty list is the answer whenever
 * the note has no headings above the task — and also whenever the cache cannot
 * answer at all, since a card must render either way.
 */
export function taskHeadings(app: App | undefined, task: Task): string[] {
  const path = task.taskLocation?.path;
  const line = task.taskLocation?.lineNumber;
  if (!app || !path || typeof line !== "number") {
    return [];
  }

  const file = app.vault?.getFileByPath?.(path) as TFile | null | undefined;
  const cache = file ? app.metadataCache?.getFileCache?.(file) : null;
  if (!cache?.headings) {
    return [];
  }

  return headingTrail(
    cache.headings.map((heading) => ({
      heading: heading.heading,
      level: heading.level,
      line: heading.position.start.line,
    })),
    line,
  );
}
