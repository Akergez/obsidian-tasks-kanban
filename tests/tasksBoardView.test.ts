import { describe, it, expect, vi } from "vitest";
import { TasksBoardView } from "../src/views/TasksBoardView";
import { findBoardBlock } from "../src/query/markdownBoard";
import type { BoardOwnState } from "../src/types/persistence";

const NOTE = [
  "---",
  "tasks-kanban: true",
  "---",
  "",
  "# 2026-W35",
  "",
  "Notes for the week.",
  "",
  "```tasks-kanban",
  "name: 2026-W35",
  "boardType: date",
  "dateField: scheduled",
  "",
  "collapsedColumns: []",
  "collapsedGroups: []",
  "```",
  "",
  "Anything after the board.",
].join("\n");

/** A board view over a note, with the TextFileView bits Obsidian would give. */
function view(note = NOTE) {
  const instance = new TasksBoardView(
    {} as never,
    {
      getTasks: () => [],
      getStatuses: () => [{ symbol: " ", name: "Todo", type: "TODO" }],
      subscribe: () => () => {},
      loadStatuses: async () => {},
      taskUpdater: {},
      app: {},
    } as never,
    { getBaseQuery: () => "", getBaseCardColors: () => "" },
  );

  const patched = instance as unknown as {
    data: string;
    file: { path: string };
    requestSave: () => void;
    persistence: { get(): BoardOwnState; save(state: BoardOwnState): void };
  };
  patched.file = { path: "Kanban/Weekly/2026-W35.md" };
  patched.requestSave = vi.fn();

  instance.setViewData(note, true);
  return { instance, patched };
}

/** The state a board hands back, with `overrides` applied. */
function state(overrides: Partial<BoardOwnState> = {}): BoardOwnState {
  return {
    query: "",
    boardType: "date",
    collapsedColumns: [],
    collapsedGroups: [],
    columns: [],
    metaColumns: [],
    actions: [],
    columnTagPrefix: "",
    columnOrder: "",
    dateField: "scheduledDate",
    dateColumns: [],
    noDateColumn: true,
    cardColors: "",
    ...overrides,
  };
}

describe("TasksBoardView: the note behind the board", () => {
  it("reads the board out of the note's block", () => {
    const { instance } = view();
    expect(instance.hasBoard()).toBe(true);
    expect(instance.getDisplayText()).toBe("2026-W35");
  });

  it("writes a fold back into the block, and only into the block", () => {
    const { instance, patched } = view();
    patched.persistence.save(state({ collapsedColumns: ["date:2026-08-24"] }));

    const text = instance.getViewData();
    expect(text.startsWith("---\ntasks-kanban: true\n---")).toBe(true);
    expect(text).toContain("Notes for the week.");
    expect(text.endsWith("Anything after the board.")).toBe(true);
    expect(findBoardBlock(text)?.body).toContain(
      'collapsedColumns:\n  - "date:2026-08-24"',
    );
    expect(patched.requestSave).toHaveBeenCalled();
  });

  it("keeps what the block already said and was not asked to change", () => {
    const { instance, patched } = view();
    patched.persistence.save(state({ collapsedGroups: ["None"] }));
    expect(findBoardBlock(instance.getViewData())?.body).toContain(
      "name: 2026-W35",
    );
  });

  it("survives a round trip through its own output", () => {
    const { instance, patched } = view();
    patched.persistence.save(state({ collapsedGroups: ["None"] }));

    const once = instance.getViewData();
    instance.setViewData(once, false);
    patched.persistence.save(state({ collapsedGroups: ["None", "Inbox.md"] }));

    const twice = instance.getViewData();
    expect(twice.split("```tasks-kanban")).toHaveLength(2);
    expect(twice.endsWith("Anything after the board.")).toBe(true);
  });

  it("reports a note with no block rather than inventing a board", () => {
    const { instance } = view("# Just a note\n\nNothing here.");
    expect(instance.hasBoard()).toBe(false);
  });

  it("leaves a note with no block untouched when there is nothing to save", () => {
    const plain = "# Just a note\n\nNothing here.";
    const { instance, patched } = view(plain);
    patched.persistence.save(state());
    expect(instance.getViewData()).toBe(plain);
  });
});
