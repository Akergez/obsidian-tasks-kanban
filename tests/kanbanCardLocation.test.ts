import { describe, it, expect } from "vitest";
import { KanbanCard } from "../src/components/KanbanCard";
import type { Task } from "../src/services/TasksIntegration";

/**
 * What a card says about where its task lives: the note, then every heading
 * above the task — drawn in full, since a location that has to be read from a
 * tooltip would not be worth showing.
 */

function task(overrides: Partial<Task> = {}): Task {
  return {
    status: { symbol: " ", name: "Todo", type: "TODO" },
    description: "Write the spec",
    tags: [],
    priority: null,
    dueDate: null,
    startDate: null,
    scheduledDate: null,
    doneDate: null,
    createdDate: null,
    cancelledDate: null,
    recurrence: null,
    id: "t1",
    dependsOn: [],
    taskLocation: { path: "Work/Projects.md", lineNumber: 12 },
    originalMarkdown: "- [ ] Write the spec",
    ...overrides,
  };
}

/** Headings as the metadata cache spells them. */
function heading(text: string, level: number, line: number) {
  return { heading: text, level, position: { start: { line } } };
}

/** An integration whose cache answers with `headings` for any file. */
function integration(headings: unknown[] | undefined) {
  const file = { path: "Work/Projects.md" };
  return {
    app: {
      vault: { getFileByPath: () => file },
      metadataCache: { getFileCache: () => (headings ? { headings } : {}) },
    },
    getTasks: () => [],
    taskUpdater: {},
  } as never;
}

/** Render a card and hand back its container. */
function render(t: Task, headings?: unknown[]) {
  const container = document.createElement("div");
  const card = new KanbanCard(container, t, integration(headings));
  card.render();
  return container;
}

/** The location's segments, in the order they are drawn. */
function segments(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(".tasks-kanban-card-file-part"),
  ).map((el) => el.textContent ?? "");
}

describe("KanbanCard: where the task lives", () => {
  it("names the note and every heading above the task", () => {
    const container = render(task(), [
      heading("Backlog", 1, 0),
      heading("Sprint 3", 2, 8),
      heading("Todo", 3, 10),
    ]);
    // The note's own name leads, then the headings inside it.
    expect(segments(container)).toEqual([
      "Projects",
      "Backlog",
      "Sprint 3",
      "Todo",
    ]);
  });

  it("leads with the note's name", () => {
    const container = render(task(), [heading("Todo", 1, 1)]);
    expect(segments(container)[0]).toBe("Projects");
    expect(segments(container)).toEqual(["Projects", "Todo"]);
  });

  it("leaves out headings the task does not sit under", () => {
    const container = render(task(), [
      heading("Sprint 2", 2, 1),
      heading("Sprint 3", 2, 9),
    ]);
    expect(segments(container)).toEqual(["Projects", "Sprint 3"]);
  });

  it("separates the segments with a chevron", () => {
    const container = render(task(), [heading("Todo", 1, 1)]);
    const separators = Array.from(
      container.querySelectorAll(".tasks-kanban-card-file-separator"),
    ).map((el) => el.textContent);
    expect(separators).toEqual(["›"]);
  });

  it("does not say the note's name twice when its H1 repeats it", () => {
    const container = render(task(), [
      heading("Projects", 1, 0),
      heading("Todo", 2, 8),
    ]);
    expect(segments(container)).toEqual(["Projects", "Todo"]);
  });

  it("is the note alone when it has no headings above the task", () => {
    expect(segments(render(task(), []))).toEqual(["Projects"]);
    expect(segments(render(task()))).toEqual(["Projects"]);
  });

  it("truncates nothing — the card grows instead", () => {
    const long = "A heading long enough that no card would fit it on one line";
    const container = render(task(), [heading(long, 1, 1)]);
    expect(segments(container)).toContain(long);
    const locationEl = container.querySelector(".tasks-kanban-card-file");
    expect(locationEl?.textContent).toContain(long);
  });

  it("keeps the footer off a card that has neither tags nor a location", () => {
    const container = render(
      task({ taskLocation: undefined as never, tags: [] }),
      [],
    );
    expect(container.querySelector(".tasks-kanban-card-footer")).toBeNull();
  });

  it("still shows the tags alongside the location", () => {
    const container = render(task({ tags: ["#work"] }), [
      heading("Todo", 1, 1),
    ]);
    expect(
      Array.from(container.querySelectorAll(".tasks-kanban-card-tag")).map(
        (el) => el.textContent,
      ),
    ).toEqual(["#work"]);
    expect(segments(container)).toEqual(["Projects", "Todo"]);
  });
});
