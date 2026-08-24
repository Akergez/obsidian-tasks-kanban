import { describe, it, expect } from "vitest";
import { colorFor, parseColorRules } from "../src/utils/cardColors";
import type { Task } from "../src/services/TasksIntegration";

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "1",
    description: "Test task",
    status: { symbol: " ", name: "Todo", type: "TODO" },
    tags: [],
    priority: null,
    dueDate: null,
    startDate: null,
    scheduledDate: null,
    doneDate: null,
    createdDate: null,
    cancelledDate: null,
    dependsOn: [],
    recurrence: null,
    taskLocation: { path: "/notes/Inbox.md", lineNumber: 1 },
    originalMarkdown: "- [ ] Test task",
    ...overrides,
  };
}

describe("parseColorRules", () => {
  it("parses a filter and colour per line", () => {
    const { rules, errors } = parseColorRules(
      "tag includes #urgent -> red\nnot done -> #3b82f6",
    );
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(2);
    expect(rules[0].color).toBe("red");
    expect(rules[0].filter).toEqual({ kind: "tag", value: "urgent" });
    expect(rules[1].color).toBe("#3b82f6");
  });

  it("ignores blank lines", () => {
    const { rules, errors } = parseColorRules(
      "\n  \ntag includes #a -> red\n\n",
    );
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(1);
  });

  it("accepts a CSS variable as the colour", () => {
    const { rules, errors } = parseColorRules("done -> var(--text-muted)");
    expect(errors).toEqual([]);
    expect(rules[0].color).toBe("var(--text-muted)");
  });

  it("rejects a colour that could escape the declaration", () => {
    const { rules, errors } = parseColorRules(
      "done -> red; background: url(x)",
    );
    expect(rules).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it("reports a line with no arrow", () => {
    const { rules, errors } = parseColorRules("tag includes #urgent red");
    expect(rules).toEqual([]);
    expect(errors[0]).toContain("Line 1");
  });

  it("reports a missing colour or missing filter", () => {
    expect(parseColorRules("done ->").errors).toHaveLength(1);
    expect(parseColorRules("-> red").errors).toHaveLength(1);
  });

  it("reports an unsupported filter, with the line number", () => {
    const { rules, errors } = parseColorRules(
      "tag includes #a -> red\npriority is high -> blue",
    );
    expect(rules).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Line 2");
  });

  it("rejects sort/group lines, which are not filters", () => {
    expect(parseColorRules("sort by due -> red").errors).toHaveLength(1);
  });

  it("keeps the colour when the filter value itself contains an arrow", () => {
    const { rules, errors } = parseColorRules(
      "description includes a -> b -> red",
    );
    expect(errors).toEqual([]);
    expect(rules[0].color).toBe("red");
    expect(rules[0].filter).toEqual({
      kind: "description",
      value: "a -> b",
    });
  });
});

describe("colorFor", () => {
  const { rules } = parseColorRules(
    ["tag includes #urgent -> red", "not done -> blue"].join("\n"),
  );

  it("returns the colour of the first matching rule", () => {
    const task = createTask({ tags: ["urgent"] });
    expect(colorFor(task, rules)).toBe("red");
  });

  it("falls through to a later rule when the first does not match", () => {
    expect(colorFor(createTask(), rules)).toBe("blue");
  });

  it("returns undefined when nothing matches", () => {
    const done = createTask({
      status: { symbol: "x", name: "Done", type: "DONE" },
    });
    expect(colorFor(done, rules)).toBeUndefined();
  });

  it("returns undefined with no rules at all", () => {
    expect(colorFor(createTask(), [])).toBeUndefined();
  });

  it("colours by file location, the same as a query would filter", () => {
    const { rules, errors } = parseColorRules(
      [
        "folder includes Work/ -> #3b82f6",
        "path includes Archive -> gray",
      ].join("\n"),
    );
    expect(errors).toEqual([]);

    const inWork = createTask({
      taskLocation: { path: "Work/Alpha.md", lineNumber: 1 },
    });
    const archived = createTask({
      taskLocation: { path: "Archive/Old.md", lineNumber: 1 },
    });
    const elsewhere = createTask({
      taskLocation: { path: "Inbox.md", lineNumber: 1 },
    });

    expect(colorFor(inWork, rules)).toBe("#3b82f6");
    expect(colorFor(archived, rules)).toBe("gray");
    expect(colorFor(elsewhere, rules)).toBeUndefined();
  });
});
