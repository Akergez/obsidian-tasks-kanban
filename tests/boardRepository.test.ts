import { describe, it, expect, vi } from "vitest";
import { TFile } from "obsidian";
import {
  BoardRepository,
  boardNameFromPath,
  sanitizeFileName,
} from "../src/services/BoardRepository";
import { emptyBoardFile } from "../src/query/boardFile";

describe("boardNameFromPath", () => {
  it("takes the base name without the extension", () => {
    expect(boardNameFromPath("Kanban/Sprint.kanban")).toBe("Sprint");
    expect(boardNameFromPath("Sprint.kanban")).toBe("Sprint");
  });

  it("ignores the extension's case", () => {
    expect(boardNameFromPath("Kanban/Sprint.KANBAN")).toBe("Sprint");
  });

  it("keeps dots that are part of the name", () => {
    expect(boardNameFromPath("Kanban/Q2.2026.kanban")).toBe("Q2.2026");
  });

  it("keeps a name that has no extension at all", () => {
    expect(boardNameFromPath("Kanban/Sprint")).toBe("Sprint");
  });
});

describe("sanitizeFileName", () => {
  it("strips characters a vault path cannot carry", () => {
    expect(sanitizeFileName('Q2: plan/review*"<>|')).toBe("Q2 planreview");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeFileName("  Sprint   board  ")).toBe("Sprint board");
  });

  it("can empty a name made only of illegal characters", () => {
    expect(sanitizeFileName("///")).toBe("");
  });

  it("leaves an ordinary name alone", () => {
    expect(sanitizeFileName("Sprint board")).toBe("Sprint board");
  });
});

describe("ensure", () => {
  /** A repository over a vault holding exactly the files named in `existing`. */
  function repository(existing: string[]) {
    const vault = {
      getAbstractFileByPath: vi.fn((path: string) =>
        existing.includes(path) ? Object.create(TFile.prototype) : null,
      ),
      modify: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(undefined),
      createFolder: vi.fn().mockResolvedValue(undefined),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = { vault } as any;
    return { repo: new BoardRepository(app, () => "Kanban"), vault };
  }

  it("writes the board when the file is not there yet", async () => {
    const { repo, vault } = repository([]);
    const created = await repo.ensure(
      "Kanban/Weekly/2026-W35.kanban",
      emptyBoardFile("2026-W35"),
    );
    expect(created).toBe(true);
    expect(vault.create).toHaveBeenCalled();
  });

  it("leaves an existing board completely alone", async () => {
    // This is what makes reopening the planner mid-week return your edits
    // rather than a fresh board.
    const { repo, vault } = repository(["Kanban/Weekly/2026-W35.kanban"]);
    const created = await repo.ensure(
      "Kanban/Weekly/2026-W35.kanban",
      emptyBoardFile("2026-W35"),
    );
    expect(created).toBe(false);
    expect(vault.create).not.toHaveBeenCalled();
    expect(vault.modify).not.toHaveBeenCalled();
  });
});
