import { describe, it, expect } from "vitest";
import { parseColorRules, colorFor } from "../src/utils/cardColors";
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

/**
 * The merge KanbanBoard.buildColorRules performs: a board's own rules first,
 * the shared ones appended below.
 */
function merged(own: string, shared: string) {
  const lines = [own, shared].filter((value) => value.trim() !== "");
  return parseColorRules(lines.join("\n")).rules;
}

describe("board rules layered over shared rules", () => {
  const shared = "tag includes #work -> blue\ntag includes #urgent -> orange";

  it("lets a board rule win over a shared rule for the same tag", () => {
    const rules = merged("tag includes #urgent -> red", shared);
    expect(colorFor(task({ tags: ["#urgent"] }), rules)).toBe("red");
  });

  it("still inherits every shared rule the board does not mention", () => {
    const rules = merged("tag includes #urgent -> red", shared);
    expect(colorFor(task({ tags: ["#work"] }), rules)).toBe("blue");
  });

  it("applies the shared rules when the board has none of its own", () => {
    const rules = merged("", shared);
    expect(colorFor(task({ tags: ["#work"] }), rules)).toBe("blue");
    expect(colorFor(task({ tags: ["#urgent"] }), rules)).toBe("orange");
  });

  it("applies the board's rules when nothing is shared", () => {
    const rules = merged("tag includes #urgent -> red", "");
    expect(colorFor(task({ tags: ["#urgent"] }), rules)).toBe("red");
  });

  it("leaves a task no rule matches uncoloured", () => {
    const rules = merged("tag includes #urgent -> red", shared);
    expect(colorFor(task({ tags: ["#other"] }), rules)).toBeUndefined();
  });

  it("keeps priority within the board's own rules, top line first", () => {
    const rules = merged(
      "tag includes #urgent -> red\ntag includes #urgent -> green",
      shared,
    );
    expect(colorFor(task({ tags: ["#urgent"] }), rules)).toBe("red");
  });

  it("does not let a blank side introduce an empty rule", () => {
    expect(merged("", "")).toEqual([]);
    expect(merged("   ", "tag includes #work -> blue")).toHaveLength(1);
  });
});
