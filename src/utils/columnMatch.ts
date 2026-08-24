import type { Task } from "../services/TasksIntegration";
import { taskDate } from "./dateColumns";
import type { KanbanColumnConfig } from "./statusColumns";
import { columnPartsOf } from "./tagColumns";

/**
 * Whether `column` collects `task` — the single matcher for all three board
 * types, so a lane's distribution and a column's drop handler can never
 * disagree about where a card belongs.
 *
 * Which mode applies is read off the column itself (see
 * {@link KanbanColumnConfig}): date columns match on the task's value for the
 * board's date field, tag columns on its column tag, status columns on its
 * status symbol. In both tag and date mode the catch-all column (an empty
 * `tag`/`date`) takes every task that has none.
 *
 * A task that no column collects is simply not rendered. On a date board that
 * is the point: a task dated outside every configured day is hidden.
 */
export function columnCollects(
  column: KanbanColumnConfig,
  task: Task,
): boolean {
  if (column.dateField !== undefined) {
    const value = taskDate(task, column.dateField);
    return column.date === "" ? value === "" : value === column.date;
  }
  if (column.tagPrefix !== undefined) {
    const parts = columnPartsOf(task, column.tagPrefix);
    if (column.tag === "") {
      return parts.length === 0;
    }
    return parts.includes(column.tag ?? "");
  }
  return column.symbols.includes(task.status.symbol);
}
