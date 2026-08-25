import { describe, it, expect } from "vitest";
import {
  buildMetaColumns,
  metaColumnErrors,
  UNNAMED_META_COLUMN_TITLE,
} from "../src/utils/metaColumns";
import { columnCollects } from "../src/utils/columnMatch";
import { buildDateColumns } from "../src/utils/dateColumns";
import type { MetaColumnConfig } from "../src/types/persistence";
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

const DONE = { symbol: "x", name: "Done", type: "DONE" };

const unplanned: MetaColumnConfig = {
  id: "meta:unplanned",
  title: "Unplanned",
  filter: ["not done", "(no scheduled date) OR (scheduled before today)"].join(
    "\n",
  ),
  mutation: ["set not done", "clear scheduled date"].join("\n"),
};

describe("buildMetaColumns", () => {
  it("turns the predicate into filters and the mutation into instructions", () => {
    const [column] = buildMetaColumns([unplanned]);
    expect(column.id).toBe("meta:unplanned");
    expect(column.title).toBe("Unplanned");
    expect(column.filters).toHaveLength(2);
    expect(column.mutation).toEqual([
      { kind: "status-done", done: false },
      { kind: "clear-date", field: "scheduledDate" },
    ]);
  });

  it("names an unnamed column rather than rendering a blank header", () => {
    const [column] = buildMetaColumns([{ ...unplanned, title: "  " }]);
    expect(column.title).toBe(UNNAMED_META_COLUMN_TITLE);
  });

  it("drops a column whose predicate holds no filter", () => {
    expect(buildMetaColumns([{ ...unplanned, filter: "" }])).toEqual([]);
    expect(buildMetaColumns([{ ...unplanned, filter: "sort by due" }])).toEqual(
      [],
    );
  });

  it("keeps a column with no mutation — it collects but moves nothing", () => {
    const [column] = buildMetaColumns([{ ...unplanned, mutation: "" }]);
    expect(column.mutation).toEqual([]);
  });
});

describe("columnCollects: meta columns", () => {
  const [column] = buildMetaColumns([unplanned]);

  it("collects unfinished work with no date", () => {
    expect(columnCollects(column, task())).toBe(true);
  });

  it("collects unfinished work whose day has passed", () => {
    expect(columnCollects(column, task({ scheduledDate: "2000-01-01" }))).toBe(
      true,
    );
  });

  it("does not collect finished work", () => {
    expect(columnCollects(column, task({ status: DONE }))).toBe(false);
  });

  it("does not collect work planned ahead", () => {
    expect(columnCollects(column, task({ scheduledDate: "2999-01-01" }))).toBe(
      false,
    );
  });

  it("overlaps the date board's catch-all, which is why it comes first", () => {
    const [noDate] = buildDateColumns("scheduledDate", []);
    const undated = task();
    expect(columnCollects(column, undated)).toBe(true);
    expect(columnCollects(noDate, undated)).toBe(true);
  });
});

describe("metaColumnErrors", () => {
  it("says nothing about a usable column", () => {
    expect(metaColumnErrors([unplanned])).toEqual([]);
  });

  it("flags a predicate that would collect everything", () => {
    expect(metaColumnErrors([{ ...unplanned, filter: "" }])).toEqual([
      "Unplanned: needs at least one filter line.",
    ]);
  });

  it("names the column a bad line belongs to", () => {
    const errors = metaColumnErrors([
      { ...unplanned, filter: "priority is high" },
      { ...unplanned, title: "", mutation: "burn it" },
    ]);
    expect(errors[0]).toContain("Unplanned:");
    expect(errors[1]).toContain("Meta column 2:");
  });
});
