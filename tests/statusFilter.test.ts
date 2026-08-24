import { describe, it, expect } from "vitest";
import {
  matchesStatusFilter,
  parseStatusFilter,
  serializeStatusFilter,
  type StatusFilterInstruction,
} from "../src/utils/statusFilter";
import type { Task } from "../src/services/TasksIntegration";

function task(type: string, name = "Some status", symbol = " "): Task {
  return {
    status: { symbol, name, type },
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
  };
}

/** Parse and assert it produced a filter (not an error / not null). */
function parsed(line: string): StatusFilterInstruction {
  const result = parseStatusFilter(line);
  if (!result || "error" in result) {
    throw new Error(
      `expected a filter for "${line}", got ${JSON.stringify(result)}`,
    );
  }
  return result.filter;
}

describe("parseStatusFilter", () => {
  it("parses the bare done / not done instructions", () => {
    expect(parsed("done")).toEqual({ kind: "status", test: "done" });
    expect(parsed("not done")).toEqual({
      kind: "status",
      test: "done",
      negated: true,
    });
  });

  it("is case-insensitive and tolerates extra inner whitespace", () => {
    expect(parsed("NOT   DONE")).toEqual({
      kind: "status",
      test: "done",
      negated: true,
    });
  });

  it("leaves `done` used as a date field to the date parser", () => {
    // `done before <date>` is a doneDate filter, not a status filter.
    expect(parseStatusFilter("done before 2026-01-01")).toBeNull();
    expect(parseStatusFilter("has done date")).toBeNull();
  });

  it("parses status.type is / is not", () => {
    expect(parsed("status.type is IN_PROGRESS")).toEqual({
      kind: "status",
      test: "type",
      value: "IN_PROGRESS",
      negated: false,
    });
    expect(parsed("status.type is not NON_TASK")).toEqual({
      kind: "status",
      test: "type",
      value: "NON_TASK",
      negated: true,
    });
  });

  it("accepts lower-case status type values, as Tasks does", () => {
    expect(parsed("status.type is in_progress").value).toBe("IN_PROGRESS");
  });

  it("reports an unknown status type", () => {
    const result = parseStatusFilter("status.type is BOGUS");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("BOGUS");
  });

  it("parses status.name includes / does not include", () => {
    expect(parsed("status.name includes progress")).toEqual({
      kind: "status",
      test: "name",
      value: "progress",
      negated: false,
    });
    expect(parsed("status.name does not include progress")).toEqual({
      kind: "status",
      test: "name",
      value: "progress",
      negated: true,
    });
  });

  it("parses status.name regex matches / does not match", () => {
    expect(parsed("status.name regex matches /^In/i")).toEqual({
      kind: "status",
      test: "name-regex",
      value: "^In",
      flags: "i",
      negated: false,
    });
    expect(parsed("status.name regex does not match /^In/")).toEqual({
      kind: "status",
      test: "name-regex",
      value: "^In",
      flags: "",
      negated: true,
    });
  });

  it("reports an invalid regular expression", () => {
    const result = parseStatusFilter("status.name regex matches /[unclosed/");
    expect(result).toHaveProperty("error");
  });

  it("returns null for lines that are not status filters", () => {
    expect(parseStatusFilter("tag includes #work")).toBeNull();
    expect(parseStatusFilter("sort by due")).toBeNull();
  });
});

describe("serializeStatusFilter", () => {
  it("round-trips every supported spelling", () => {
    const lines = [
      "done",
      "not done",
      "status.type is DONE",
      "status.type is not CANCELLED",
      "status.name includes progress",
      "status.name does not include progress",
      "status.name regex matches /^In/i",
      "status.name regex does not match /^In/",
    ];
    for (const line of lines) {
      expect(serializeStatusFilter(parsed(line))).toBe(line);
    }
  });
});

describe("matchesStatusFilter", () => {
  const done = parsed("done");
  const notDone = parsed("not done");

  it("treats DONE, CANCELLED and NON_TASK as done, per the Tasks reference", () => {
    for (const type of ["DONE", "CANCELLED", "NON_TASK"]) {
      expect(matchesStatusFilter(task(type), done)).toBe(true);
      expect(matchesStatusFilter(task(type), notDone)).toBe(false);
    }
  });

  it("treats TODO, IN_PROGRESS and ON_HOLD as not done", () => {
    for (const type of ["TODO", "IN_PROGRESS", "ON_HOLD"]) {
      expect(matchesStatusFilter(task(type), done)).toBe(false);
      expect(matchesStatusFilter(task(type), notDone)).toBe(true);
    }
  });

  it("keeps done / not done exhaustive for an unrecognised type", () => {
    const odd = task("SOMETHING_NEW");
    expect(matchesStatusFilter(odd, done)).toBe(false);
    expect(matchesStatusFilter(odd, notDone)).toBe(true);
  });

  it("matches status.type exactly", () => {
    expect(
      matchesStatusFilter(
        task("IN_PROGRESS"),
        parsed("status.type is IN_PROGRESS"),
      ),
    ).toBe(true);
    expect(
      matchesStatusFilter(task("TODO"), parsed("status.type is IN_PROGRESS")),
    ).toBe(false);
    expect(
      matchesStatusFilter(
        task("TODO"),
        parsed("status.type is not IN_PROGRESS"),
      ),
    ).toBe(true);
  });

  it("matches status.name as a case-insensitive substring", () => {
    const filter = parsed("status.name includes PROGRESS");
    expect(
      matchesStatusFilter(task("IN_PROGRESS", "In Progress"), filter),
    ).toBe(true);
    expect(matchesStatusFilter(task("TODO", "Todo"), filter)).toBe(false);
  });

  it("negates status.name does not include", () => {
    const filter = parsed("status.name does not include progress");
    expect(matchesStatusFilter(task("TODO", "Todo"), filter)).toBe(true);
    expect(
      matchesStatusFilter(task("IN_PROGRESS", "In Progress"), filter),
    ).toBe(false);
  });

  it("applies the regex case-sensitively unless the i flag is given", () => {
    expect(
      matchesStatusFilter(
        task("IN_PROGRESS", "In Progress"),
        parsed("status.name regex matches /^in/"),
      ),
    ).toBe(false);
    expect(
      matchesStatusFilter(
        task("IN_PROGRESS", "In Progress"),
        parsed("status.name regex matches /^in/i"),
      ),
    ).toBe(true);
  });
});
