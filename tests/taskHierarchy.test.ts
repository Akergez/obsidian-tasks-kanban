import { describe, it, expect } from "vitest";
import { indentOf, nestTasks, taskKey } from "../src/utils/taskHierarchy";
import type { Task } from "../src/services/TasksIntegration";

/** Build a task at `path:line` whose source line has `indent` spaces. */
function createTask(
  id: string,
  path: string,
  lineNumber: number,
  indent = "",
  tags: string[] = [],
): Task {
  return {
    id,
    description: id,
    status: { symbol: " ", name: "Todo", type: "TODO" },
    tags,
    priority: null,
    dueDate: null,
    startDate: null,
    scheduledDate: null,
    doneDate: null,
    createdDate: null,
    cancelledDate: null,
    dependsOn: [],
    recurrence: null,
    taskLocation: { path, lineNumber },
    originalMarkdown: `${indent}- [ ] ${id}`,
  };
}

const ids = (tasks: Task[]) => tasks.map((t) => t.id);
const subIds = (result: ReturnType<typeof nestTasks>, key: string) =>
  (result.subTasksOf.get(key) ?? []).map((s) => s.task.id);

describe("indentOf", () => {
  it("measures spaces", () => {
    expect(indentOf(createTask("a", "f.md", 0, "    "))).toBe(4);
  });

  it("counts a tab as four spaces", () => {
    expect(indentOf(createTask("a", "f.md", 0, "\t"))).toBe(4);
    expect(indentOf(createTask("a", "f.md", 0, "\t\t"))).toBe(8);
  });

  it("is zero for an unindented line", () => {
    expect(indentOf(createTask("a", "f.md", 0))).toBe(0);
  });
});

describe("nestTasks", () => {
  it("keeps unindented tasks as roots with no sub-tasks", () => {
    const tasks = [createTask("a", "f.md", 0), createTask("b", "f.md", 1)];
    const result = nestTasks(tasks);
    expect(ids(result.roots)).toEqual(["a", "b"]);
    expect(result.subTasksOf.size).toBe(0);
  });

  it("attaches an indented task to the task above it", () => {
    const tasks = [
      createTask("parent", "f.md", 0),
      createTask("child", "f.md", 1, "    "),
    ];
    const result = nestTasks(tasks);
    expect(ids(result.roots)).toEqual(["parent"]);
    expect(subIds(result, "f.md:0")).toEqual(["child"]);
  });

  it("attaches deep descendants to the top-level root, with their depth", () => {
    const tasks = [
      createTask("root", "f.md", 0),
      createTask("child", "f.md", 1, "    "),
      createTask("grandchild", "f.md", 2, "        "),
    ];
    const result = nestTasks(tasks);
    expect(ids(result.roots)).toEqual(["root"]);
    expect(subIds(result, "f.md:0")).toEqual(["child", "grandchild"]);
    expect(result.subTasksOf.get("f.md:0")?.map((s) => s.depth)).toEqual([
      1, 2,
    ]);
  });

  it("starts a new root when the indent returns to zero", () => {
    const tasks = [
      createTask("a", "f.md", 0),
      createTask("a1", "f.md", 1, "    "),
      createTask("b", "f.md", 2),
      createTask("b1", "f.md", 3, "    "),
    ];
    const result = nestTasks(tasks);
    expect(ids(result.roots)).toEqual(["a", "b"]);
    expect(subIds(result, "f.md:0")).toEqual(["a1"]);
    expect(subIds(result, "f.md:2")).toEqual(["b1"]);
  });

  it("treats siblings at the same indent as siblings, not a chain", () => {
    const tasks = [
      createTask("root", "f.md", 0),
      createTask("x", "f.md", 1, "    "),
      createTask("y", "f.md", 2, "    "),
    ];
    const result = nestTasks(tasks);
    expect(result.subTasksOf.get("f.md:0")?.map((s) => s.depth)).toEqual([
      1, 1,
    ]);
  });

  it("never nests across files", () => {
    const tasks = [
      createTask("a", "one.md", 0),
      createTask("b", "two.md", 0, "    "),
    ];
    const result = nestTasks(tasks);
    expect(ids(result.roots)).toEqual(["a", "b"]);
  });

  it("reads nesting in line order even when the input is shuffled", () => {
    const tasks = [
      createTask("child", "f.md", 1, "    "),
      createTask("parent", "f.md", 0),
    ];
    const result = nestTasks(tasks);
    expect(ids(result.roots)).toEqual(["parent"]);
    expect(subIds(result, "f.md:0")).toEqual(["child"]);
  });

  it("preserves the caller's order of roots, so an applied sort survives", () => {
    const tasks = [
      createTask("b", "f.md", 2),
      createTask("a", "f.md", 0),
      createTask("a1", "f.md", 1, "    "),
    ];
    expect(ids(nestTasks(tasks).roots)).toEqual(["b", "a"]);
  });

  it("keeps a location-less task as its own root", () => {
    const orphan = createTask("orphan", "f.md", 0);
    orphan.taskLocation = undefined as never;
    const result = nestTasks([orphan]);
    expect(ids(result.roots)).toEqual(["orphan"]);
    expect(taskKey(orphan)).toBe("");
  });

  it("nests an indented task under a deeper-but-earlier branch correctly", () => {
    // A dedent that lands between two open levels re-parents to the nearer one.
    const tasks = [
      createTask("root", "f.md", 0),
      createTask("deep", "f.md", 1, "        "),
      createTask("mid", "f.md", 2, "    "),
    ];
    const result = nestTasks(tasks);
    expect(ids(result.roots)).toEqual(["root"]);
    expect(subIds(result, "f.md:0")).toEqual(["deep", "mid"]);
    expect(result.subTasksOf.get("f.md:0")?.map((s) => s.depth)).toEqual([
      1, 1,
    ]);
  });
});
