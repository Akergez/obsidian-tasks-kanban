import { describe, it, expect } from "vitest";
import {
  boardBlock,
  boardNote,
  findBoardBlock,
  replaceBoardBlockBody,
} from "../src/query/markdownBoard";

const note = [
  "# My board",
  "",
  "Some notes about the week.",
  "",
  "```tasks-kanban",
  "boardType: date",
  "dateField: scheduled",
  "```",
  "",
  "And a paragraph after it.",
].join("\n");

describe("findBoardBlock", () => {
  it("finds the block and reports the lines it spans", () => {
    expect(findBoardBlock(note)).toEqual({
      body: "boardType: date\ndateField: scheduled",
      lineStart: 4,
      lineEnd: 7,
    });
  });

  it("returns null for a note with no board in it", () => {
    expect(findBoardBlock("# Just a note\n\n```js\nconsole.log(1)\n```")).toBe(
      null,
    );
  });

  it("ignores the language's case and trailing spaces", () => {
    const found = findBoardBlock("```Tasks-Kanban  \nboardType: tag\n```");
    expect(found?.body).toBe("boardType: tag");
  });

  it("reads an unclosed fence to the end, as Obsidian does", () => {
    const found = findBoardBlock("```tasks-kanban\nboardType: tag");
    expect(found).toEqual({ body: "boardType: tag", lineStart: 0, lineEnd: 1 });
  });

  it("takes the first block when a note carries several", () => {
    const two = [
      "```tasks-kanban",
      "boardType: status",
      "```",
      "```tasks-kanban",
      "boardType: tag",
      "```",
    ].join("\n");
    expect(findBoardBlock(two)?.body).toBe("boardType: status");
  });

  it("round-trips what boardBlock and boardNote write", () => {
    expect(findBoardBlock(boardBlock("boardType: tag"))?.body).toBe(
      "boardType: tag",
    );
    expect(findBoardBlock(boardNote("Sprint", "boardType: tag"))?.body).toBe(
      "boardType: tag",
    );
  });
});

describe("replaceBoardBlockBody", () => {
  it("replaces only the block's body", () => {
    const updated = replaceBoardBlockBody(note, 4, 7, "boardType: tag");
    expect(updated).toBe(
      [
        "# My board",
        "",
        "Some notes about the week.",
        "",
        "```tasks-kanban",
        "boardType: tag",
        "```",
        "",
        "And a paragraph after it.",
      ].join("\n"),
    );
  });

  it("handles a body longer than the one it replaces", () => {
    const updated = replaceBoardBlockBody(note, 4, 7, "a\nb\nc");
    expect(findBoardBlock(updated)?.body).toBe("a\nb\nc");
    expect(updated.endsWith("And a paragraph after it.")).toBe(true);
  });

  it("leaves the note alone when the range is not a block", () => {
    // A stale section range must never eat a paragraph.
    expect(replaceBoardBlockBody(note, 2, 3, "boardType: tag")).toBe(note);
    expect(replaceBoardBlockBody(note, 4, 99, "boardType: tag")).toBe(note);
    expect(replaceBoardBlockBody(note, -1, 7, "boardType: tag")).toBe(note);
  });

  it("survives a round trip through its own output", () => {
    const once = replaceBoardBlockBody(note, 4, 7, "boardType: tag");
    const block = findBoardBlock(once)!;
    const twice = replaceBoardBlockBody(
      once,
      block.lineStart,
      block.lineEnd,
      "boardType: status",
    );
    expect(findBoardBlock(twice)?.body).toBe("boardType: status");
  });
});
