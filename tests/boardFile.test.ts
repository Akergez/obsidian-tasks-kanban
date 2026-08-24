import { describe, it, expect } from "vitest";
import {
  emptyBoardFile,
  parseBoardFile,
  serializeBoardFile,
  type BoardFile,
} from "../src/query/boardFile";

function board(overrides: Partial<BoardFile> = {}): BoardFile {
  return { ...emptyBoardFile("Sprint"), ...overrides };
}

/** Serialize then parse, asserting no errors, to check a value survives. */
function roundTrip(input: BoardFile): BoardFile {
  const text = serializeBoardFile(input);
  const { board: parsed, errors } = parseBoardFile(text, "fallback");
  expect(errors).toEqual([]);
  return parsed;
}

describe("serializeBoardFile", () => {
  it("writes multi-line fields as block scalars, not escaped one-liners", () => {
    const text = serializeBoardFile(
      board({ query: "tag includes #work\nnot done\nsort by due" }),
    );
    expect(text).toContain("query: |-\n");
    expect(text).toContain("  tag includes #work\n  not done\n  sort by due");
    expect(text).not.toContain("\\n");
  });

  it("omits fields left at their default", () => {
    const text = serializeBoardFile(board());
    expect(text).not.toContain("query:");
    expect(text).not.toContain("cardColors:");
    expect(text).not.toContain("columnTagPrefix:");
    expect(text).not.toContain("columns:");
  });

  it("always writes the fold lists, so their shape is discoverable", () => {
    const text = serializeBoardFile(board());
    expect(text).toContain("collapsedColumns: []");
    expect(text).toContain("collapsedGroups: []");
  });

  it("ends with a trailing newline", () => {
    expect(serializeBoardFile(board())).toMatch(/\n$/);
  });
});

describe("round trip", () => {
  it("preserves a fully populated board", () => {
    const input = board({
      name: "Sprint board",
      query: "tag includes #work\nnot done\nsort by due reverse",
      columnTagPrefix: "sprint",
      columnOrder: "todo, doing, done",
      cardColors: "tag includes #urgent -> red\nfolder includes Work/ -> blue",
      columns: [{ id: "c1", title: "Doing", symbols: ["/", "A"] }],
      collapsedColumns: ["tag:sprint_done"],
      collapsedGroups: ["Inbox.md", "None"],
    });
    expect(roundTrip(input)).toEqual(input);
  });

  it("preserves an empty board", () => {
    const input = board({ name: "Empty" });
    expect(roundTrip(input)).toEqual(input);
  });

  it("preserves a multi-line value's blank lines", () => {
    const input = board({ query: "tag includes #a\n\nsort by due" });
    expect(roundTrip(input).query).toBe("tag includes #a\n\nsort by due");
  });

  it("preserves a name needing quotes", () => {
    const input = board({ name: "Q2: planning & review" });
    expect(roundTrip(input).name).toBe("Q2: planning & review");
  });

  it("preserves a space status symbol in a custom column", () => {
    const input = board({
      columns: [{ id: "c1", title: "Todo", symbols: [" ", "x"] }],
    });
    expect(roundTrip(input).columns[0].symbols).toEqual([" ", "x"]);
  });
});

describe("parseBoardFile", () => {
  it("reads a hand-written file", () => {
    const { board: parsed, errors } = parseBoardFile(
      [
        "name: Sprint",
        "columnTagPrefix: sprint",
        "query: |-",
        "  not done",
        "collapsedColumns: []",
      ].join("\n"),
      "fallback",
    );
    expect(errors).toEqual([]);
    expect(parsed.name).toBe("Sprint");
    expect(parsed.columnTagPrefix).toBe("sprint");
    expect(parsed.query).toBe("not done");
  });

  it("falls back to the file name when no name is given", () => {
    expect(parseBoardFile("query: not done", "My board").board.name).toBe(
      "My board",
    );
    expect(parseBoardFile("name: '  '", "My board").board.name).toBe(
      "My board",
    );
  });

  it("treats an empty file as an empty board", () => {
    const { board: parsed, errors } = parseBoardFile("", "Empty");
    expect(errors).toEqual([]);
    expect(parsed).toEqual(emptyBoardFile("Empty"));
  });

  it("reports malformed YAML instead of throwing", () => {
    const { board: parsed, errors } = parseBoardFile("name: [unclosed", "Bad");
    expect(errors).toHaveLength(1);
    expect(parsed).toEqual(emptyBoardFile("Bad"));
  });

  it("rejects a document that is not a mapping", () => {
    expect(parseBoardFile("- a\n- b", "Bad").errors).toHaveLength(1);
  });

  it("drops columns with no symbols, which could not render", () => {
    const { board: parsed } = parseBoardFile(
      ["columns:", "  - title: Empty", "    symbols: []"].join("\n"),
      "B",
    );
    expect(parsed.columns).toEqual([]);
  });

  it("reports a columns key that is not a list", () => {
    const { board: parsed, errors } = parseBoardFile("columns: nope", "B");
    expect(parsed.columns).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it("ignores non-string entries in the fold lists", () => {
    const { board: parsed } = parseBoardFile(
      "collapsedGroups:\n  - ok\n  - 5\n  - true",
      "B",
    );
    expect(parsed.collapsedGroups).toEqual(["ok"]);
  });

  it("coerces a numeric scalar rather than dropping it", () => {
    expect(parseBoardFile("columnOrder: 2026", "B").board.columnOrder).toBe(
      "2026",
    );
  });
});
