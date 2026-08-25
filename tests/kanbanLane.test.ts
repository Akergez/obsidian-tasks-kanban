import { describe, it, expect, vi } from "vitest";
import { KanbanLane } from "../src/components/KanbanLane";
import { buildDateColumns } from "../src/utils/dateColumns";
import { buildMetaColumns } from "../src/utils/metaColumns";
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

const integration = {
  getTasks: vi.fn().mockReturnValue([]),
  taskUpdater: {},
  app: {},
} as never;

/** Render one lane and report how many cards each column holds. */
function cardsPerColumn(
  columns: KanbanColumnConfig[],
  tasks: Task[],
): number[] {
  const container = document.createElement("div");
  const lane = new KanbanLane(
    container,
    "",
    "",
    columns,
    integration,
    new Set(),
    false,
    () => {},
    () => {},
  );
  lane.updateTasks(tasks);
  const counts = Array.from(
    container.querySelectorAll(".tasks-kanban-column-cards"),
  ).map((el) => el.querySelectorAll(".tasks-kanban-card").length);
  lane.destroy();
  return counts;
}

describe("KanbanLane: distributing tasks across columns", () => {
  const metaColumns = buildMetaColumns([
    {
      id: "meta:unplanned",
      title: "Unplanned",
      filter: [
        "not done",
        "(no scheduled date) OR (scheduled before today)",
      ].join("\n"),
      mutation: "",
    },
  ]);
  const dateColumns = buildDateColumns("scheduledDate", [
    { id: "date:2999-01-01", title: "Someday", date: "2999-01-01" },
    { id: "date:2000-01-01", title: "Long ago", date: "2000-01-01" },
  ]);
  const columns = [...metaColumns, ...dateColumns];

  it("shows a task in the first column that collects it, not in both", () => {
    // The meta column and the date board's "No date" catch-all both collect an
    // undated todo; leading, the meta column takes it.
    const counts = cardsPerColumn(columns, [task()]);
    expect(counts).toEqual([1, 0, 0, 0]);
  });

  it("lets a task the meta column does not claim fall through", () => {
    const done = task({ status: { symbol: "x", name: "Done", type: "DONE" } });
    const counts = cardsPerColumn(columns, [done]);
    expect(counts).toEqual([0, 1, 0, 0]);
  });

  it("still sends a task planned ahead to its day", () => {
    const counts = cardsPerColumn(columns, [
      task({ scheduledDate: "2999-01-01" }),
    ]);
    expect(counts).toEqual([0, 0, 1, 0]);
  });

  it("takes unfinished work off a day that has passed", () => {
    // The point of the planner's pool: a day gone by no longer holds the card.
    const counts = cardsPerColumn(columns, [
      task({ scheduledDate: "2000-01-01" }),
    ]);
    expect(counts).toEqual([1, 0, 0, 0]);
  });

  it("leaves finished work on the past day it was done", () => {
    const done = task({
      scheduledDate: "2000-01-01",
      status: { symbol: "x", name: "Done", type: "DONE" },
    });
    expect(cardsPerColumn(columns, [done])).toEqual([0, 0, 0, 1]);
  });

  it("shows nothing for a task no column collects", () => {
    const done = task({
      scheduledDate: "2026-06-15",
      status: { symbol: "x", name: "Done", type: "DONE" },
    });
    expect(cardsPerColumn(columns, [done])).toEqual([0, 0, 0, 0]);
  });
});
