import { describe, it, expect } from "vitest";
import { columnCollects } from "../src/utils/columnMatch";
import { buildTagColumns } from "../src/utils/tagColumns";
import { buildDateColumns } from "../src/utils/dateColumns";
import type { KanbanColumnConfig } from "../src/utils/statusColumns";
import type { Task } from "../src/services/TasksIntegration";

function task(overrides: Partial<Task> = {}): Task {
  return {
    status: { symbol: " ", name: "Todo", type: "TODO" },
    description: "Test task",
    tags: [],
    priority: null,
    dueDate: null,
    startDate: null,
    scheduledDate: null,
    doneDate: null,
    createdDate: null,
    cancelledDate: null,
    recurrence: null,
    id: "",
    dependsOn: [],
    taskLocation: { path: "note.md", lineNumber: 0 },
    originalMarkdown: "- [ ] Test task",
    ...overrides,
  };
}

describe("columnCollects: tag columns", () => {
  const [catchAll, todo] = buildTagColumns(
    [task({ tags: ["#sprint_todo"] })],
    "sprint",
  );

  it("matches a tag column on the task's tag", () => {
    expect(columnCollects(todo, task({ tags: ["#sprint_todo"] }))).toBe(true);
    expect(columnCollects(todo, task({ tags: ["#sprint_done"] }))).toBe(false);
  });

  it("sends untagged tasks to the catch-all column", () => {
    expect(columnCollects(catchAll, task({ tags: ["#work"] }))).toBe(true);
    expect(columnCollects(catchAll, task())).toBe(true);
    expect(columnCollects(catchAll, task({ tags: ["#sprint_todo"] }))).toBe(
      false,
    );
  });
});

describe("columnCollects: status columns", () => {
  const statusColumn: KanbanColumnConfig = {
    id: "todo",
    title: "Todo",
    symbols: [" "],
    dropSymbol: " ",
  };

  it("matches on the status symbol", () => {
    expect(columnCollects(statusColumn, task({ tags: ["#sprint_done"] }))).toBe(
      true,
    );
    expect(
      columnCollects(
        statusColumn,
        task({ status: { symbol: "x", name: "Done", type: "DONE" } }),
      ),
    ).toBe(false);
  });
});

describe("columnCollects: date columns", () => {
  const [noDate, monday] = buildDateColumns("scheduledDate", [
    { id: "c1", title: "Monday", date: "2026-08-24" },
  ]);

  it("matches a day column on the task's date in that field", () => {
    expect(columnCollects(monday, task({ scheduledDate: "2026-08-24" }))).toBe(
      true,
    );
    expect(columnCollects(monday, task({ scheduledDate: "2026-08-25" }))).toBe(
      false,
    );
  });

  it("ignores the task's other date fields", () => {
    expect(columnCollects(monday, task({ dueDate: "2026-08-24" }))).toBe(false);
    expect(columnCollects(noDate, task({ dueDate: "2026-08-24" }))).toBe(true);
  });

  it("sends undated tasks to the catch-all column", () => {
    expect(columnCollects(noDate, task())).toBe(true);
    expect(columnCollects(noDate, task({ scheduledDate: "2026-08-24" }))).toBe(
      false,
    );
  });

  it("normalises the task's date before comparing", () => {
    // The cache may hand over a datetime string or a Date rather than a day.
    expect(
      columnCollects(monday, task({ scheduledDate: "2026-08-24T09:30:00" })),
    ).toBe(true);
    expect(
      columnCollects(
        monday,
        task({ scheduledDate: new Date(2026, 7, 24) as unknown as string }),
      ),
    ).toBe(true);
  });

  it("collects no task at all when the day matches none", () => {
    // This is what hides a task dated outside every configured column.
    const columns = buildDateColumns("scheduledDate", [
      { id: "c1", title: "", date: "2026-08-24" },
    ]);
    const stray = task({ scheduledDate: "2026-12-31" });
    expect(columns.some((column) => columnCollects(column, stray))).toBe(false);
  });
});
