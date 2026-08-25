import { describe, it, expect } from "vitest";
import {
  applyMutations,
  applyStatusChange,
  parseMutation,
  parseMutationLine,
  serializeMutation,
  type MutationContext,
} from "../src/utils/taskMutation";
import type { StatusInfo, Task } from "../src/services/TasksIntegration";

const STATUSES: StatusInfo[] = [
  { symbol: " ", name: "Todo", type: "TODO" },
  { symbol: "/", name: "In Progress", type: "IN_PROGRESS" },
  { symbol: "x", name: "Done", type: "DONE" },
  { symbol: "-", name: "Cancelled", type: "CANCELLED" },
];

function context(overrides: Partial<MutationContext> = {}): MutationContext {
  return {
    statusOf: (symbol) => STATUSES.find((s) => s.symbol === symbol),
    symbolForType: (type) =>
      STATUSES.find((s) => s.type === type)?.symbol ?? null,
    format: "tasksPluginEmoji",
    setDoneDate: true,
    setCancelledDate: true,
    today: "2026-08-25",
    ...overrides,
  };
}

function task(symbol = " "): Task {
  const status = STATUSES.find((s) => s.symbol === symbol) ?? STATUSES[0];
  return {
    status: { ...status },
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

/** Parse a mutation, asserting it has no errors, and apply it to `line`. */
function apply(
  line: string,
  mutation: string,
  symbol = " ",
  ctx: MutationContext = context(),
): string | null {
  const { mutations, errors } = parseMutation(mutation);
  expect(errors).toEqual([]);
  return applyMutations(line, task(symbol), mutations, ctx);
}

describe("parseMutationLine", () => {
  it("parses the status instructions", () => {
    expect(parseMutationLine("set done")).toEqual({
      mutation: { kind: "status-done", done: true },
    });
    expect(parseMutationLine("set not done")).toEqual({
      mutation: { kind: "status-done", done: false },
    });
    expect(parseMutationLine("set status /")).toEqual({
      mutation: { kind: "status", symbol: "/" },
    });
    expect(parseMutationLine("set status [ ]")).toEqual({
      mutation: { kind: "status", symbol: " " },
    });
  });

  it("parses date instructions", () => {
    expect(parseMutationLine("set scheduled today")).toEqual({
      mutation: { kind: "date", field: "scheduledDate", value: "today" },
    });
    expect(parseMutationLine("set due 2026-09-01")).toEqual({
      mutation: { kind: "date", field: "dueDate", value: "2026-09-01" },
    });
    expect(parseMutationLine("clear scheduled date")).toEqual({
      mutation: { kind: "clear-date", field: "scheduledDate" },
    });
    expect(parseMutationLine("clear due")).toEqual({
      mutation: { kind: "clear-date", field: "dueDate" },
    });
  });

  it("parses tag instructions", () => {
    expect(parseMutationLine("add tag #work")).toEqual({
      mutation: { kind: "tag", value: "work", remove: false },
    });
    expect(parseMutationLine("remove tag #work")).toEqual({
      mutation: { kind: "tag", value: "work", remove: true },
    });
  });

  it("rejects a value that is not a day", () => {
    const result = parseMutationLine("set scheduled soon");
    expect("error" in result && result.error).toContain("not a day");
  });

  it("rejects an unknown instruction", () => {
    const result = parseMutationLine("delete the task");
    expect("error" in result && result.error).toContain("unsupported");
  });

  it("reports a bad line by number and keeps the rest", () => {
    const { mutations, errors } = parseMutation(
      ["set not done", "burn it", "clear scheduled date"].join("\n"),
    );
    expect(mutations).toHaveLength(2);
    expect(errors).toEqual([expect.stringContaining("Line 2")]);
  });

  it("round-trips through serialization", () => {
    const lines = [
      "set done",
      "set not done",
      "set status /",
      "set scheduled today",
      "clear due date",
      "add tag #work",
      "remove tag #work",
    ];
    for (const line of lines) {
      const result = parseMutationLine(line);
      expect("mutation" in result && serializeMutation(result.mutation)).toBe(
        line,
      );
    }
  });
});

describe("applyMutations", () => {
  it("un-dones a task and clears its scheduled date", () => {
    const line = "- [x] Write the report ⏳ 2026-08-20 ✅ 2026-08-24";
    expect(apply(line, "set not done\nclear scheduled date", "x")).toBe(
      "- [ ] Write the report",
    );
  });

  it("writes a relative day against the context's today", () => {
    expect(apply("- [ ] Task", "set scheduled tomorrow")).toBe(
      "- [ ] Task ⏳ 2026-08-26",
    );
  });

  it("writes an exact day", () => {
    expect(apply("- [ ] Task", "set due 2026-09-01")).toBe(
      "- [ ] Task 📅 2026-09-01",
    );
  });

  it("stamps the done date when it sets done", () => {
    expect(apply("- [ ] Task", "set done")).toBe("- [x] Task ✅ 2026-08-25");
  });

  it("honours the vault's own done symbol", () => {
    const ctx = context({
      symbolForType: (type) => (type === "DONE" ? "X" : " "),
    });
    expect(apply("- [ ] Task", "set done", " ", ctx)).toBe("- [X] Task");
  });

  it("leaves the status alone when the vault has no status of that type", () => {
    const ctx = context({ symbolForType: () => null });
    expect(apply("- [x] Task", "set not done", "x", ctx)).toBe("- [x] Task");
  });

  it("applies instructions in order, tracking the status as it goes", () => {
    // `set done` stamps the done date, `set not done` then removes it again.
    expect(apply("- [ ] Task", "set done\nset not done")).toBe("- [ ] Task");
  });

  it("adds and removes tags", () => {
    expect(apply("- [ ] Task", "add tag #work")).toBe("- [ ] Task #work");
    expect(apply("- [ ] Task #work", "add tag #work")).toBe("- [ ] Task #work");
    expect(apply("- [ ] Task #work #home", "remove tag #work")).toBe(
      "- [ ] Task #home",
    );
    expect(apply("- [ ] Task #workshop", "remove tag #work")).toBe(
      "- [ ] Task #workshop",
    );
  });

  it("keeps a trailing block reference last", () => {
    expect(apply("- [ ] Task ^abc", "add tag #work")).toBe(
      "- [ ] Task #work ^abc",
    );
    expect(apply("- [ ] Task ^abc", "set scheduled today")).toBe(
      "- [ ] Task ⏳ 2026-08-25 ^abc",
    );
  });

  it("writes dataview fields when that is the format", () => {
    const ctx = context({ format: "dataview" });
    expect(apply("- [ ] Task", "set scheduled today", " ", ctx)).toBe(
      "- [ ] Task  [scheduled:: 2026-08-25]",
    );
  });

  it("returns null for a line that is not a task", () => {
    expect(apply("Just a paragraph", "set done")).toBeNull();
  });

  it("does nothing for an empty mutation", () => {
    expect(applyMutations("- [ ] Task", task(), [], context())).toBe(
      "- [ ] Task",
    );
  });
});

describe("applyStatusChange", () => {
  it("keeps the done date rule in one place", () => {
    expect(applyStatusChange("- [ ] Task", " ", "x", context())).toBe(
      "- [x] Task ✅ 2026-08-25",
    );
    expect(
      applyStatusChange("- [x] Task ✅ 2026-08-20", "x", " ", context()),
    ).toBe("- [ ] Task");
  });

  it("respects the setDoneDate setting", () => {
    expect(
      applyStatusChange(
        "- [ ] Task",
        " ",
        "x",
        context({ setDoneDate: false }),
      ),
    ).toBe("- [x] Task");
  });

  it("swaps the cancelled date for the done date", () => {
    expect(
      applyStatusChange("- [-] Task ❌ 2026-08-20", "-", "x", context()),
    ).toBe("- [x] Task ✅ 2026-08-25");
  });
});
