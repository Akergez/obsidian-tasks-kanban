import { describe, it, expect, vi } from "vitest";
import { TFile } from "obsidian";
import { BoardNotes } from "../src/services/BoardNotes";
import { BOARD_FRONTMATTER } from "../src/query/markdownBoard";

const BOARD_NOTE = `${BOARD_FRONTMATTER}# Sprint\n\n\`\`\`tasks-kanban\nboardType: date\n\`\`\`\n`;
const PLAIN_NOTE = "# Just a note\n\nNothing here.\n";

/** A file the vault will hand back, with the content it holds. */
function file(path: string): TFile {
  const stub = Object.create(TFile.prototype) as TFile;
  Object.assign(stub, {
    path,
    basename: path.replace(/\.md$/, ""),
    extension: path.slice(path.lastIndexOf(".") + 1),
  });
  return stub;
}

/** BoardNotes over a vault of `contents`, keyed by path. */
function notes(
  contents: Record<string, string>,
  frontmatter: Record<string, unknown> = {},
) {
  const cachedRead = vi.fn(async (f: TFile) => contents[f.path] ?? "");
  const app = {
    vault: { cachedRead },
    metadataCache: {
      getCache: (path: string) =>
        frontmatter[path] ? { frontmatter: frontmatter[path] } : null,
    },
  };
  return { boards: new BoardNotes(app as never), cachedRead };
}

describe("BoardNotes.isBoardFile", () => {
  it("reads the file, so a note written a moment ago still counts", async () => {
    // The metadata cache lags a fresh file; this is the path opening a board
    // takes, and it must not depend on the cache having caught up.
    const { boards } = notes({ "Kanban/Sprint.md": BOARD_NOTE });
    expect(await boards.isBoardFile(file("Kanban/Sprint.md"))).toBe(true);
  });

  it("counts a note carrying a block but declaring nothing", async () => {
    const pasted = "# Notes\n\n```tasks-kanban\nboardType: tag\n```\n";
    const { boards } = notes({ "Notes.md": pasted });
    expect(await boards.isBoardFile(file("Notes.md"))).toBe(true);
  });

  it("says no to an ordinary note", async () => {
    const { boards } = notes({ "Notes.md": PLAIN_NOTE });
    expect(await boards.isBoardFile(file("Notes.md"))).toBe(false);
  });

  it("takes the declaration without reading, when the cache has it", async () => {
    const { boards, cachedRead } = notes(
      { "Kanban/Sprint.md": BOARD_NOTE },
      { "Kanban/Sprint.md": { "tasks-kanban": true } },
    );
    expect(await boards.isBoardFile(file("Kanban/Sprint.md"))).toBe(true);
    expect(cachedRead).not.toHaveBeenCalled();
  });

  it("remembers what it read, and tells the explorer to redraw", async () => {
    const { boards, cachedRead } = notes({ "Kanban/Sprint.md": BOARD_NOTE });
    const changed = vi.fn();
    boards.onChange(changed);

    await boards.isBoardFile(file("Kanban/Sprint.md"));

    expect(changed).toHaveBeenCalled();
    expect(boards.isBoard("Kanban/Sprint.md")).toBe(true);
    await boards.isBoardFile(file("Kanban/Sprint.md"));
    expect(cachedRead).toHaveBeenCalledTimes(1);
  });
});

describe("BoardNotes.isBoard", () => {
  it("answers from the declaration alone, without touching the disk", () => {
    const { boards, cachedRead } = notes(
      {},
      { "Kanban/Sprint.md": { "tasks-kanban": true } },
    );
    expect(boards.isBoard("Kanban/Sprint.md")).toBe(true);
    expect(boards.isBoard("Other.md")).toBe(false);
    expect(cachedRead).not.toHaveBeenCalled();
  });
});
