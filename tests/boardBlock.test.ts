import { describe, it, expect, vi } from "vitest";
import { TFile } from "obsidian";
import { BoardBlock } from "../src/components/BoardBlock";
import { findBoardBlock } from "../src/query/markdownBoard";
import type { BoardOwnState } from "../src/types/persistence";

const NOTE = [
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

const BODY = findBoardBlock(NOTE)!;

/** A board block over a one-note vault, with the block's real line range. */
function block(options: { section?: boolean; file?: boolean } = {}) {
  const { section = true, file = true } = options;
  let text = NOTE;

  const vault = {
    getAbstractFileByPath: vi.fn(() =>
      file ? Object.create(TFile.prototype) : null,
    ),
    process: vi.fn(async (_file: unknown, fn: (data: string) => string) => {
      text = fn(text);
      return text;
    }),
  };

  const app = {
    vault,
    workspace: { getLeavesOfType: () => [], setActiveLeaf: vi.fn() },
  };

  const tasksIntegration = {
    app,
    getTasks: () => [],
    getStatuses: () => [{ symbol: " ", name: "Todo", type: "TODO" }],
    subscribe: () => () => {},
    taskUpdater: {},
  };

  const ctx = {
    sourcePath: "Kanban/Weekly/2026-W35.md",
    getSectionInfo: () =>
      section
        ? { text: NOTE, lineStart: BODY.lineStart, lineEnd: BODY.lineEnd }
        : null,
    addChild: vi.fn(),
  };

  const el = document.createElement("div");
  const instance = new BoardBlock(
    el,
    BODY.body,
    ctx as never,
    app as never,
    tasksIntegration as never,
    { getBaseQuery: () => "", getBaseCardColors: () => "" },
  );

  return { instance, vault, noteText: () => text };
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

/** Reach the private writer: what a fold or a settings save ends up calling. */
async function save(instance: BoardBlock, next: BoardOwnState): Promise<void> {
  await (
    instance as unknown as {
      writeState: (s: BoardOwnState) => Promise<void>;
    }
  ).writeState(next);
}

describe("BoardBlock: writing the board back into its note", () => {
  it("renders the board into the block's element", () => {
    const { instance } = block();
    instance.onload();
    expect(
      instance.containerEl.querySelector(".tasks-kanban-board"),
    ).not.toBeNull();
    instance.onunload();
  });

  it("rewrites only the block, leaving the note around it alone", async () => {
    const { instance, noteText } = block();
    await save(instance, state({ collapsedColumns: ["date:2026-08-24"] }));

    const text = noteText();
    expect(text.startsWith("# 2026-W35\n\nNotes for the week.")).toBe(true);
    expect(text.endsWith("Anything after the board.")).toBe(true);
    expect(findBoardBlock(text)?.body).toContain(
      'collapsedColumns:\n  - "date:2026-08-24"',
    );
  });

  it("keeps what the block already said and was not asked to change", async () => {
    const { instance, noteText } = block();
    await save(instance, state({ collapsedGroups: ["None"] }));
    expect(findBoardBlock(noteText())?.body).toContain("name: 2026-W35");
  });

  it("writes nothing when the block's lines are not known", async () => {
    // No section info: better an un-persisted fold than a guessed line range.
    const { instance, vault } = block({ section: false });
    await save(instance, state({ collapsedGroups: ["None"] }));
    expect(vault.process).not.toHaveBeenCalled();
  });

  it("writes nothing when the note is gone", async () => {
    const { instance, vault } = block({ file: false });
    await save(instance, state({ collapsedGroups: ["None"] }));
    expect(vault.process).not.toHaveBeenCalled();
  });
});
