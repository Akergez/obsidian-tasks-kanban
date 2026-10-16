import { describe, it, expect, vi } from "vitest";
import { KanbanLane } from "../src/components/KanbanLane";
import { buildDateColumns } from "../src/utils/dateColumns";
import { buildMetaColumns } from "../src/utils/metaColumns";
import { metaCardFiltersFor } from "../src/utils/metaCards";
import type { MetaCardConfig } from "../src/types/persistence";
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

describe("KanbanLane: meta cards", () => {
  const columns = buildDateColumns(
    "scheduledDate",
    [
      { id: "mon", title: "", date: "2026-08-24" },
      { id: "tue", title: "", date: "2026-08-25" },
      { id: "wed", title: "", date: "2026-08-26" },
    ],
    false,
  );
  const rules: MetaCardConfig[] = [
    {
      id: "card:ongoing",
      title: "Ongoing",
      filter:
        "(starts on {{day}}) OR ((starts before {{day}}) AND (has due date) AND NOT (due before {{day}}))",
    },
  ];
  const metaCards = new Map(
    columns.map((column) => [column.id, metaCardFiltersFor(rules, column)]),
  );

  /** Render one lane; report each column's cards as "own"/"meta". */
  function render(tasks: Task[]): string[][] {
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
    lane.updateTasks(tasks, [], new Map(), [], metaCards);
    const result = Array.from(
      container.querySelectorAll(".tasks-kanban-column-cards"),
    ).map((el) =>
      Array.from(el.querySelectorAll(".tasks-kanban-card")).map((card) =>
        card.classList.contains("tasks-kanban-card-meta") ? "meta" : "own",
      ),
    );
    lane.destroy();
    return result;
  }

  it("shows one task read-only in every day it spans", () => {
    const span = task({ startDate: "2026-08-24", dueDate: "2026-08-25" });
    expect(render([span])).toEqual([["meta"], ["meta"], []]);
  });

  it("keeps the task's own card, and adds no copy beside it", () => {
    const span = task({
      startDate: "2026-08-24",
      dueDate: "2026-08-26",
      scheduledDate: "2026-08-25",
    });
    expect(render([span])).toEqual([["meta"], ["own"], ["meta"]]);
  });

  it("puts meta cards after the column's own", () => {
    const own = task({
      scheduledDate: "2026-08-24",
      originalMarkdown: "- [ ] own",
    });
    const span = task({
      startDate: "2026-08-24",
      originalMarkdown: "- [ ] span",
    });
    expect(render([span, own])).toEqual([["own", "meta"], [], []]);
  });

  it("does not let a meta card be dragged", () => {
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
    lane.updateTasks(
      [task({ startDate: "2026-08-24" })],
      [],
      new Map(),
      [],
      metaCards,
    );
    const card = container.querySelector(".tasks-kanban-card-meta");
    expect(card?.getAttribute("draggable")).toBe("false");
    lane.destroy();
  });

  it("does not count meta cards as the column's own", () => {
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
    lane.updateTasks(
      [task({ startDate: "2026-08-24" })],
      [],
      new Map(),
      [],
      metaCards,
    );
    expect(
      container.querySelector(".tasks-kanban-column-count")?.textContent,
    ).toBe("0");
    lane.destroy();
  });
});
