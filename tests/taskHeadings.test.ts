import { describe, it, expect } from "vitest";
import {
  headingTrail,
  taskHeadings,
  type HeadingRef,
} from "../src/utils/taskHeadings";
import type { Task } from "../src/services/TasksIntegration";

/** `# Project` on line 0, `## Sprint 3` on line 4, and so on. */
function headings(...rows: [string, number, number][]): HeadingRef[] {
  return rows.map(([heading, level, line]) => ({ heading, level, line }));
}

describe("headingTrail", () => {
  const note = headings(
    ["Project", 1, 0],
    ["Sprint 2", 2, 5],
    ["Done", 3, 6],
    ["Sprint 3", 2, 10],
    ["Todo", 3, 11],
    ["Notes", 1, 30],
  );

  it("gives the whole chain of sections a task sits in", () => {
    expect(headingTrail(note, 12)).toEqual(["Project", "Sprint 3", "Todo"]);
  });

  it("leaves out sections that merely came earlier", () => {
    // Sprint 2 and its Done are closed by Sprint 3, not containing line 12.
    expect(headingTrail(note, 12)).not.toContain("Sprint 2");
    expect(headingTrail(note, 12)).not.toContain("Done");
  });

  it("stops at the heading the task is directly under", () => {
    expect(headingTrail(note, 7)).toEqual(["Project", "Sprint 2", "Done"]);
  });

  it("ignores headings below the task", () => {
    expect(headingTrail(note, 31)).toEqual(["Notes"]);
  });

  it("is empty above the first heading", () => {
    expect(headingTrail(note, 0)).toEqual([]);
  });

  it("is empty for a note with no headings", () => {
    expect(headingTrail([], 4)).toEqual([]);
  });

  it("handles a skipped level", () => {
    const skipped = headings(["Top", 1, 0], ["Deep", 3, 1]);
    expect(headingTrail(skipped, 2)).toEqual(["Top", "Deep"]);
  });

  it("keeps only the last of repeated same-level headings", () => {
    const repeated = headings(["One", 2, 0], ["Two", 2, 4], ["Three", 2, 8]);
    expect(headingTrail(repeated, 9)).toEqual(["Three"]);
  });

  it("closes a deep section when a shallower one follows", () => {
    const reopened = headings(
      ["A", 1, 0],
      ["A.1", 2, 1],
      ["A.1.1", 3, 2],
      ["B", 1, 10],
    );
    expect(headingTrail(reopened, 11)).toEqual(["B"]);
  });

  it("drops a heading that is only whitespace, and trims the rest", () => {
    const messy = headings(["  Spaced  ", 1, 0], ["   ", 2, 1]);
    expect(headingTrail(messy, 3)).toEqual(["Spaced"]);
  });

  it("leaves the line just above a heading in the section that is ending", () => {
    // Line 10 is where `## Sprint 3` is written, so everything before it still
    // belongs to the section Sprint 3 closes.
    expect(headingTrail(note, 10)).toEqual(["Project", "Sprint 2", "Done"]);
  });
});

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
    taskLocation: { path: "note.md", lineNumber: 3 },
    originalMarkdown: "- [ ] Test task",
    ...overrides,
  };
}

/** An app whose cache answers for `note.md` alone. */
function app(cache: unknown) {
  const file = { path: "note.md" };
  return {
    vault: {
      getFileByPath: (path: string) => (path === "note.md" ? file : null),
    },
    metadataCache: { getFileCache: () => cache },
  } as never;
}

describe("taskHeadings", () => {
  it("reads the trail out of the metadata cache", () => {
    const cache = {
      headings: [
        { heading: "Project", level: 1, position: { start: { line: 0 } } },
        { heading: "Todo", level: 2, position: { start: { line: 2 } } },
      ],
    };
    expect(taskHeadings(app(cache), task())).toEqual(["Project", "Todo"]);
  });

  it("answers empty rather than throwing when the cache cannot help", () => {
    expect(taskHeadings(app({}), task())).toEqual([]);
    expect(taskHeadings(app(null), task())).toEqual([]);
    expect(taskHeadings(undefined, task())).toEqual([]);
    expect(taskHeadings({} as never, task())).toEqual([]);
  });

  it("answers empty for a task the cache has no file for", () => {
    const cache = {
      headings: [
        { heading: "Project", level: 1, position: { start: { line: 0 } } },
      ],
    };
    expect(
      taskHeadings(
        app(cache),
        task({ taskLocation: { path: "other.md", lineNumber: 3 } }),
      ),
    ).toEqual([]);
  });
});
