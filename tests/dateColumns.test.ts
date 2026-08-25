import { describe, it, expect } from "vitest";
import {
  DATE_FIELDS,
  NO_DATE_COLUMN_ID,
  NO_DATE_COLUMN_TITLE,
  buildDateColumns,
  dateFieldKeyword,
  isValidColumnDate,
  resolveDateField,
  taskDate,
  todayISO,
} from "../src/utils/dateColumns";
import { DEFAULT_DATE_FIELD } from "../src/utils/dateFilter";
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

describe("isValidColumnDate", () => {
  it("accepts an exact day", () => {
    expect(isValidColumnDate("2026-08-24")).toBe(true);
    expect(isValidColumnDate("  2026-08-24  ")).toBe(true);
  });

  it("rejects anything that is not a plain YYYY-MM-DD day", () => {
    expect(isValidColumnDate("")).toBe(false);
    expect(isValidColumnDate("today")).toBe(false);
    expect(isValidColumnDate("2026-8-4")).toBe(false);
    expect(isValidColumnDate("2026-08-24T00:00")).toBe(false);
  });

  it("rejects a day that does not exist", () => {
    expect(isValidColumnDate("2026-02-31")).toBe(false);
    expect(isValidColumnDate("2026-13-01")).toBe(false);
  });
});

describe("todayISO", () => {
  it("uses the local calendar day, not the UTC one", () => {
    // Late on the 24th in a zone behind UTC would be the 25th in UTC.
    expect(todayISO(new Date(2026, 7, 24, 23, 30))).toBe("2026-08-24");
  });
});

describe("resolveDateField", () => {
  it("accepts an internal field name", () => {
    expect(resolveDateField("startDate")).toBe("startDate");
  });

  it("accepts the Tasks keyword a hand-written file would use", () => {
    expect(resolveDateField("due")).toBe("dueDate");
    expect(resolveDateField("Scheduled")).toBe("scheduledDate");
  });

  it("falls back to the default for anything else", () => {
    expect(resolveDateField(undefined)).toBe(DEFAULT_DATE_FIELD);
    expect(resolveDateField("nonsense")).toBe(DEFAULT_DATE_FIELD);
    expect(resolveDateField(42)).toBe(DEFAULT_DATE_FIELD);
  });

  it("round-trips through the keyword spelling", () => {
    for (const field of DATE_FIELDS) {
      expect(resolveDateField(dateFieldKeyword(field))).toBe(field);
    }
  });
});

describe("taskDate", () => {
  it("reads the named field, normalised to a day", () => {
    expect(taskDate(task({ dueDate: "2026-08-24" }), "dueDate")).toBe(
      "2026-08-24",
    );
    expect(
      taskDate(task({ scheduledDate: "2026-08-24T09:30:00" }), "scheduledDate"),
    ).toBe("2026-08-24");
  });

  it("reports a missing date as an empty string", () => {
    expect(taskDate(task(), "dueDate")).toBe("");
  });
});

describe("buildDateColumns without the catch-all", () => {
  it("leaves out the No date column when it is turned off", () => {
    const columns = buildDateColumns(
      "dueDate",
      [{ id: "a", title: "Monday", date: "2026-08-24" }],
      false,
    );
    expect(columns.map((c) => c.id)).toEqual(["a"]);
  });

  it("can end up with no columns at all", () => {
    expect(buildDateColumns("dueDate", [], false)).toEqual([]);
  });
});

describe("buildDateColumns", () => {
  it("leads with the catch-all column for undated tasks", () => {
    const columns = buildDateColumns("dueDate", []);
    expect(columns).toHaveLength(1);
    expect(columns[0].id).toBe(NO_DATE_COLUMN_ID);
    expect(columns[0].title).toBe(NO_DATE_COLUMN_TITLE);
    expect(columns[0].date).toBe("");
    expect(columns[0].dateField).toBe("dueDate");
  });

  it("keeps the configured order rather than sorting by date", () => {
    const columns = buildDateColumns("dueDate", [
      { id: "b", title: "", date: "2026-08-26" },
      { id: "a", title: "", date: "2026-08-24" },
    ]);
    expect(columns.map((c) => c.date)).toEqual([
      "",
      "2026-08-26",
      "2026-08-24",
    ]);
  });

  it("falls back to the date itself when a column has no title", () => {
    const [, column] = buildDateColumns("dueDate", [
      { id: "a", title: "  ", date: "2026-08-24" },
    ]);
    expect(column.title).toBe("2026-08-24");
  });

  it("keeps a title when one is given", () => {
    const [, column] = buildDateColumns("dueDate", [
      { id: "a", title: "Monday", date: "2026-08-24" },
    ]);
    expect(column.title).toBe("Monday");
  });

  it("drops columns whose day could not be read", () => {
    const columns = buildDateColumns("dueDate", [
      { id: "a", title: "", date: "not a date" },
      { id: "b", title: "", date: "2026-08-24" },
    ]);
    expect(columns.map((c) => c.id)).toEqual([NO_DATE_COLUMN_ID, "b"]);
  });

  it("drops a repeated day, which no drop could disambiguate", () => {
    const columns = buildDateColumns("dueDate", [
      { id: "a", title: "First", date: "2026-08-24" },
      { id: "b", title: "Second", date: "2026-08-24" },
    ]);
    expect(columns.map((c) => c.id)).toEqual([NO_DATE_COLUMN_ID, "a"]);
  });

  it("carries the board's date field onto every column", () => {
    const columns = buildDateColumns("startDate", [
      { id: "a", title: "", date: "2026-08-24" },
    ]);
    expect(columns.every((c) => c.dateField === "startDate")).toBe(true);
  });
});
