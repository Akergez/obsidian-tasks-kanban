import type { Task } from "../services/TasksIntegration";

/** The path's parent folder, always ending in `/` (root → `/`). */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "/" : path.slice(0, slash + 1);
}

/** The file name without its `.md` extension. */
export function fileNameOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.md$/i, "");
}

/**
 * The name of the note a task lives in, without the `.md` extension, or "" when
 * the task carries no location (which the Tasks cache can briefly hand us).
 * Shared by the card's parent-file label, filename grouping, and filename sort,
 * so all three spell the same note the same way.
 */
export function taskFileName(task: Task): string {
  const path = task.taskLocation?.path;
  return path ? fileNameOf(path) : "";
}
