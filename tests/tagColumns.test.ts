import { describe, it, expect } from "vitest";
import {
  NO_COLUMN_ID,
  buildTagColumns,
  columnPart,
  parseColumnOrder,
  setColumnTag,
} from "../src/utils/tagColumns";
import type { Task } from "../src/services/TasksIntegration";

function task(tags: string[], statusSymbol = " "): Task {
  return {
    status: { symbol: statusSymbol, name: "Todo", type: "TODO" },
    description: "Test task",
    tags,
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
  };
}

describe("columnPart", () => {
  it("returns the part after the prefix", () => {
    expect(columnPart("sprint_todo", "sprint")).toBe("todo");
  });

  it("keeps further separators in the part", () => {
    expect(columnPart("sprint_in_progress", "sprint")).toBe("in_progress");
  });

  it("returns null for another board's tag", () => {
    expect(columnPart("other_todo", "sprint")).toBeNull();
  });

  it("returns null for the bare prefix", () => {
    expect(columnPart("sprint_", "sprint")).toBeNull();
    expect(columnPart("sprint", "sprint")).toBeNull();
  });
});

describe("buildTagColumns", () => {
  it("emits the catch-all column first, then one column per tag", () => {
    const columns = buildTagColumns(
      [task(["#sprint_todo"]), task(["#sprint_done"])],
      "sprint",
    );

    expect(columns.map((c) => c.id)).toEqual([
      NO_COLUMN_ID,
      "tag:sprint_done",
      "tag:sprint_todo",
    ]);
    expect(columns.map((c) => c.tag)).toEqual(["", "done", "todo"]);
    expect(columns.every((c) => c.tagPrefix === "sprint")).toBe(true);
  });

  it("titles a column from its tag part", () => {
    const [, column] = buildTagColumns(
      [task(["#sprint_in_progress"])],
      "sprint",
    );
    expect(column.title).toBe("In progress");
  });

  it("deduplicates tags and ignores other prefixes", () => {
    const columns = buildTagColumns(
      [task(["#sprint_todo", "#work"]), task(["sprint_todo", "#other_done"])],
      "sprint",
    );
    expect(columns.map((c) => c.tag)).toEqual(["", "todo"]);
  });

  it("emits only the catch-all when nothing is tagged", () => {
    const columns = buildTagColumns([task(["#work"])], "sprint");
    expect(columns).toHaveLength(1);
    expect(columns[0].id).toBe(NO_COLUMN_ID);
  });

  it("puts ordered columns first, in the given order", () => {
    const columns = buildTagColumns(
      [task(["#sprint_done"]), task(["#sprint_todo"]), task(["#sprint_doing"])],
      "sprint",
      ["todo", "doing", "done"],
    );
    expect(columns.map((c) => c.tag)).toEqual(["", "todo", "doing", "done"]);
  });

  it("appends unordered columns alphabetically after the ordered ones", () => {
    const columns = buildTagColumns(
      [task(["#sprint_zeta"]), task(["#sprint_alpha"]), task(["#sprint_done"])],
      "sprint",
      ["done"],
    );
    expect(columns.map((c) => c.tag)).toEqual(["", "done", "alpha", "zeta"]);
  });

  it("keeps an ordered column that no task carries yet", () => {
    const columns = buildTagColumns([task(["#sprint_todo"])], "sprint", [
      "todo",
      "done",
    ]);
    expect(columns.map((c) => c.tag)).toEqual(["", "todo", "done"]);
  });
});

describe("parseColumnOrder", () => {
  it("splits on commas and trims", () => {
    expect(parseColumnOrder("todo, doing ,done", "sprint")).toEqual([
      "todo",
      "doing",
      "done",
    ]);
  });

  it("accepts full tags as well as bare column names", () => {
    expect(
      parseColumnOrder("#sprint_todo, sprint_doing, done", "sprint"),
    ).toEqual(["todo", "doing", "done"]);
  });

  it("drops blanks and duplicates", () => {
    expect(parseColumnOrder("todo, , todo, done,", "sprint")).toEqual([
      "todo",
      "done",
    ]);
  });

  it("returns nothing for an empty setting", () => {
    expect(parseColumnOrder("", "sprint")).toEqual([]);
  });
});

describe("setColumnTag", () => {
  it("replaces the existing column tag in place", () => {
    expect(
      setColumnTag(
        "- [ ] Write tests #sprint_todo 📅 2026-01-01",
        "sprint",
        "doing",
      ),
    ).toBe("- [ ] Write tests #sprint_doing 📅 2026-01-01");
  });

  it("appends the tag when the line has none", () => {
    expect(setColumnTag("- [ ] Write tests", "sprint", "todo")).toBe(
      "- [ ] Write tests #sprint_todo",
    );
  });

  it("removes the tag when moving to the catch-all column", () => {
    expect(setColumnTag("- [ ] Write tests #sprint_todo", "sprint", "")).toBe(
      "- [ ] Write tests",
    );
  });

  it("keeps one tag when the line carried several", () => {
    expect(
      setColumnTag("- [ ] A #sprint_todo B #sprint_done C", "sprint", "doing"),
    ).toBe("- [ ] A #sprint_doing B C");
  });

  it("leaves other tags alone", () => {
    expect(
      setColumnTag("- [ ] A #work #sprint_todo #other_done", "sprint", "doing"),
    ).toBe("- [ ] A #work #sprint_doing #other_done");
  });

  it("preserves indentation", () => {
    expect(setColumnTag("  - [ ] A #sprint_todo", "sprint", "")).toBe(
      "  - [ ] A",
    );
  });

  it("treats a regex-special prefix literally", () => {
    expect(setColumnTag("- [ ] A #a.b_todo", "a.b", "done")).toBe(
      "- [ ] A #a.b_done",
    );
    expect(setColumnTag("- [ ] A #axb_todo", "a.b", "done")).toBe(
      "- [ ] A #axb_todo #a.b_done",
    );
  });
});
