import { describe, it, expect } from "vitest";
import { taskMatchesFilters } from "../src/query/boardQuery";
import { buildDateColumns } from "../src/utils/dateColumns";
import { metaCardErrors, metaCardFiltersFor } from "../src/utils/metaCards";
import { resolveColumns } from "../src/utils/statusColumns";
import type { MetaCardConfig } from "../src/types/persistence";
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

const ongoing: MetaCardConfig = {
  id: "card:ongoing",
  title: "Ongoing",
  filter:
    "(starts on {{day}}) OR ((starts before {{day}}) AND (has due date) AND NOT (due before {{day}}))",
};

const [noDate, monday, wednesday] = buildDateColumns(
  "scheduledDate",
  [
    { id: "d1", title: "", date: "2026-08-24" },
    { id: "d3", title: "", date: "2026-08-26" },
  ],
  true,
);

/** Whether `subject` shows as a meta card in `column`. */
function shows(column: typeof monday, subject: Task): boolean {
  return metaCardFiltersFor([ongoing], column).some((filters) =>
    taskMatchesFilters(subject, filters),
  );
}

describe("metaCardFiltersFor", () => {
  it("renders {{day}} as the column's own day", () => {
    const starting = task({ startDate: "2026-08-26" });
    expect(shows(wednesday, starting)).toBe(true);
    expect(shows(monday, starting)).toBe(false);
  });

  it("puts one task in every day between its start and its due date", () => {
    const span = task({ startDate: "2026-08-20", dueDate: "2026-08-26" });
    expect(shows(monday, span)).toBe(true);
    expect(shows(wednesday, span)).toBe(true);

    const ended = task({ startDate: "2026-08-20", dueDate: "2026-08-25" });
    expect(shows(monday, ended)).toBe(true);
    expect(shows(wednesday, ended)).toBe(false);
  });

  it("leaves out a task that only started, with no due date to end it", () => {
    expect(shows(wednesday, task({ startDate: "2026-08-20" }))).toBe(false);
  });

  it("gives a column with no day nothing to render {{day}} with", () => {
    expect(metaCardFiltersFor([ongoing], noDate)).toEqual([]);
    const [todo] = resolveColumns(
      [],
      [{ symbol: " ", name: "Todo", type: "TODO" }],
    );
    expect(metaCardFiltersFor([ongoing], todo)).toEqual([]);
  });

  it("applies a rule that names no day to every column", () => {
    const pinned: MetaCardConfig = {
      id: "card:pinned",
      title: "Pinned",
      filter: "tag includes #pinned",
    };
    expect(metaCardFiltersFor([pinned], noDate)).toHaveLength(1);
    expect(metaCardFiltersFor([pinned], wednesday)).toHaveLength(1);
  });

  it("skips a rule with no usable filter", () => {
    const empty: MetaCardConfig = { id: "e", title: "", filter: "  " };
    expect(metaCardFiltersFor([empty], wednesday)).toEqual([]);
  });
});

describe("metaCardErrors", () => {
  it("accepts the {{day}} rule", () => {
    expect(metaCardErrors([ongoing])).toEqual([]);
  });

  it("names the broken rule", () => {
    expect(
      metaCardErrors([{ id: "x", title: "Broken", filter: "frobnicate" }]),
    ).toEqual([expect.stringMatching(/^Broken: /)]);
  });

  it("asks for at least one filter line", () => {
    expect(metaCardErrors([{ id: "x", title: "", filter: "" }])).toEqual([
      "Meta card 1: needs at least one filter line.",
    ]);
  });
});
