import { describe, it, expect } from "vitest";
import {
  parseQuery,
  serializeQuery,
  taskMatchesFilters,
} from "../src/query/boardQuery";
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

/** Parse one line and match a task against it. */
function matches(line: string, subject: Task): boolean {
  const { query, errors } = parseQuery(line);
  expect(errors).toEqual([]);
  return taskMatchesFilters(subject, query.filters);
}

describe("boolean filters: parsing", () => {
  it("parses an OR of two filters", () => {
    const { query, errors } = parseQuery("(done) OR (tag includes #work)");
    expect(errors).toEqual([]);
    expect(query.filters).toEqual([
      {
        kind: "boolean",
        op: "or",
        operands: [
          { kind: "status", test: "done" },
          { kind: "tag", value: "work" },
        ],
      },
    ]);
  });

  it("flattens a chain of the same operator", () => {
    const { query } = parseQuery("(done) OR (not done) OR (tag includes #a)");
    const filter = query.filters[0];
    expect(filter.kind).toBe("boolean");
    expect(filter.kind === "boolean" && filter.operands).toHaveLength(3);
  });

  it("parses NOT and nested groups", () => {
    const { query, errors } = parseQuery(
      "NOT ((tag includes #a) AND (tag includes #b))",
    );
    expect(errors).toEqual([]);
    expect(query.filters[0]).toEqual({
      kind: "boolean",
      op: "not",
      operands: [
        {
          kind: "boolean",
          op: "and",
          operands: [
            { kind: "tag", value: "a" },
            { kind: "tag", value: "b" },
          ],
        },
      ],
    });
  });

  it("binds AND tighter than OR", () => {
    const { query } = parseQuery("(done) OR (tag includes #a) AND (done)");
    const filter = query.filters[0];
    expect(filter.kind === "boolean" && filter.op).toBe("or");
    expect(
      filter.kind === "boolean" && filter.operands[1].kind === "boolean",
    ).toBe(true);
  });

  it("reports an unbalanced expression rather than ignoring it", () => {
    const { errors } = parseQuery("(done OR (tag includes #a)");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("unbalanced");
  });

  it("reports the error of a sub-filter that does not parse", () => {
    const { errors } = parseQuery("(done) OR (priority is high)");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("priority is high");
  });

  it("leaves a plain filter with brackets in its text alone", () => {
    const { query, errors } = parseQuery(
      "status.name regex matches /^(In|On)/",
    );
    expect(errors).toEqual([]);
    expect(query.filters[0].kind).toBe("status");
  });

  it("reads a lowercase 'or' as ordinary description text", () => {
    const { query, errors } = parseQuery("description includes cats or dogs");
    expect(errors).toEqual([]);
    expect(query.filters).toEqual([
      { kind: "description", value: "cats or dogs" },
    ]);
  });

  it("round-trips through serialization", () => {
    const line = "(no scheduled date) OR (scheduled before today)";
    const { query } = parseQuery(line);
    expect(serializeQuery(query)).toBe(line);
  });
});

describe("boolean filters: matching", () => {
  const line = "(no scheduled date) OR (scheduled before today)";

  it("matches a task with no scheduled date", () => {
    expect(matches(line, task())).toBe(true);
  });

  it("matches a task scheduled in the past", () => {
    expect(matches(line, task({ scheduledDate: "2000-01-01" }))).toBe(true);
  });

  it("does not match a task scheduled far ahead", () => {
    expect(matches(line, task({ scheduledDate: "2999-01-01" }))).toBe(false);
  });

  it("means 'carries this tag' inside a boolean, not the board's tag pool", () => {
    // Two top-level `tag includes` lines OR together; inside a boolean each
    // operand stands on its own, so AND really means AND.
    const both = "(tag includes #a) AND (tag includes #b)";
    expect(matches(both, task({ tags: ["#a"] }))).toBe(false);
    expect(matches(both, task({ tags: ["#a", "#b"] }))).toBe(true);
  });

  it("negates with NOT", () => {
    expect(matches("NOT (done)", task())).toBe(true);
    expect(
      matches(
        "NOT (done)",
        task({ status: { symbol: "x", name: "Done", type: "DONE" } }),
      ),
    ).toBe(false);
  });

  it("XOR matches exactly one side", () => {
    const line = "(tag includes #a) XOR (tag includes #b)";
    expect(matches(line, task({ tags: ["#a"] }))).toBe(true);
    expect(matches(line, task({ tags: ["#a", "#b"] }))).toBe(false);
    expect(matches(line, task())).toBe(false);
  });

  it("ANDs a boolean line with the other filter lines", () => {
    const query = parseQuery(
      ["not done", "(no scheduled date) OR (scheduled before today)"].join(
        "\n",
      ),
    ).query;
    const done = task({
      status: { symbol: "x", name: "Done", type: "DONE" },
    });
    expect(taskMatchesFilters(task(), query.filters)).toBe(true);
    expect(taskMatchesFilters(done, query.filters)).toBe(false);
  });
});
