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
    expect(text).not.toContain("dateColumns:");
  });

  it("always writes the board type, even at its default", () => {
    expect(serializeBoardFile(board())).toContain("boardType: status");
    expect(serializeBoardFile(board({ boardType: "date" }))).toContain(
      "boardType: date",
    );
  });

  it("writes the date field only for a date board, as a Tasks keyword", () => {
    expect(
      serializeBoardFile(
        board({ boardType: "date", dateField: "scheduledDate" }),
      ),
    ).toContain("dateField: scheduled");
    expect(serializeBoardFile(board({ boardType: "status" }))).not.toContain(
      "dateField:",
    );
  });

  it("quotes a column date so YAML cannot read it back as a timestamp", () => {
    const text = serializeBoardFile(
      board({
        boardType: "date",
        dateColumns: [{ id: "c1", title: "Monday", date: "2026-08-24" }],
      }),
    );
    expect(text).toContain('date: "2026-08-24"');
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
      boardType: "tag",
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

  it("preserves a date board with the catch-all turned off", () => {
    const input = board({
      boardType: "date",
      noDateColumn: false,
      dateColumns: [{ id: "c1", title: "Monday", date: "2026-08-24" }],
    });
    expect(roundTrip(input)).toEqual(input);
  });

  it("preserves meta columns, predicate and mutation alike", () => {
    const input = board({
      metaColumns: [
        {
          id: "meta:unplanned",
          title: "Unplanned",
          filter: "not done\n(no scheduled date) OR (scheduled before today)",
          mutation: "set not done\nclear scheduled date",
        },
        {
          id: "meta:blocked",
          title: "Blocked",
          filter: "tag includes #blocked",
          mutation: "",
        },
      ],
    });
    expect(roundTrip(input)).toEqual(input);
  });

  it("preserves a date board", () => {
    const input = board({
      name: "This week",
      boardType: "date",
      dateField: "startDate",
      dateColumns: [
        { id: "c1", title: "Monday", date: "2026-08-24" },
        { id: "c2", title: "", date: "2026-08-25" },
      ],
    });
    expect(roundTrip(input)).toEqual(input);
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

  it("keeps the catch-all for a date board that does not mention it", () => {
    const { board: parsed } = parseBoardFile(
      ["boardType: date", "dateField: due"].join("\n"),
      "fallback",
    );
    expect(parsed.noDateColumn).toBe(true);
  });

  it("writes the catch-all flag only when it is off", () => {
    const on = serializeBoardFile(board({ boardType: "date" }));
    const off = serializeBoardFile(
      board({ boardType: "date", noDateColumn: false }),
    );
    expect(on).not.toContain("noDateColumn");
    expect(off).toContain("noDateColumn: false");
  });

  it("reads hand-written meta columns", () => {
    const { board: parsed, errors } = parseBoardFile(
      [
        "name: Planner",
        "boardType: date",
        "metaColumns:",
        "  - id: meta:unplanned",
        "    title: Unplanned",
        "    filter: |-",
        "      not done",
        "      (no scheduled date) OR (scheduled before today)",
        "    mutation: |-",
        "      set not done",
        "      clear scheduled date",
      ].join("\n"),
      "fallback",
    );
    expect(errors).toEqual([]);
    expect(parsed.metaColumns).toEqual([
      {
        id: "meta:unplanned",
        title: "Unplanned",
        filter: "not done\n(no scheduled date) OR (scheduled before today)",
        mutation: "set not done\nclear scheduled date",
      },
    ]);
  });

  it("drops a meta column with no filter, which could collect nothing", () => {
    const { board: parsed } = parseBoardFile(
      [
        "metaColumns:",
        "  - id: meta:empty",
        "    title: Everything",
        "    mutation: set done",
      ].join("\n"),
      "fallback",
    );
    expect(parsed.metaColumns).toEqual([]);
  });

  it("reports a metaColumns key that is not a list", () => {
    const { errors } = parseBoardFile("metaColumns: nope", "fallback");
    expect(errors).toEqual(["`metaColumns` must be a list; ignoring it."]);
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

  it("infers the type of a board written before types were explicit", () => {
    expect(parseBoardFile("columnTagPrefix: sprint", "B").board.boardType).toBe(
      "tag",
    );
    expect(parseBoardFile("query: not done", "B").board.boardType).toBe(
      "status",
    );
  });

  it("lets an explicit type win over the old implicit rule", () => {
    const { board: parsed } = parseBoardFile(
      "boardType: date\ncolumnTagPrefix: sprint",
      "B",
    );
    expect(parsed.boardType).toBe("date");
    // The tag settings survive, so switching back in the pane restores them.
    expect(parsed.columnTagPrefix).toBe("sprint");
  });

  it("falls back to the default type for an unknown one", () => {
    expect(parseBoardFile("boardType: nonsense", "B").board.boardType).toBe(
      "status",
    );
  });

  it("reads a hand-written date board, keyword and bare day included", () => {
    const { board: parsed, errors } = parseBoardFile(
      [
        "boardType: date",
        "dateField: due",
        "dateColumns:",
        "  - id: c1",
        "    title: Monday",
        "    date: 2026-08-24",
      ].join("\n"),
      "B",
    );
    expect(errors).toEqual([]);
    expect(parsed.dateField).toBe("dueDate");
    // A bare YYYY-MM-DD is a YAML timestamp; it must come back as the day.
    expect(parsed.dateColumns).toEqual([
      { id: "c1", title: "Monday", date: "2026-08-24" },
    ]);
  });

  it("gives a date column with no id one, so its fold state has a key", () => {
    const { board: parsed } = parseBoardFile(
      ["dateColumns:", '  - date: "2026-08-24"'].join("\n"),
      "B",
    );
    expect(parsed.dateColumns).toHaveLength(1);
    expect(parsed.dateColumns[0].id).not.toBe("");
  });

  it("drops date columns with no usable day", () => {
    const { board: parsed } = parseBoardFile(
      [
        "dateColumns:",
        "  - id: a",
        '    date: "nope"',
        "  - id: b",
        '    date: "2026-08-24"',
      ].join("\n"),
      "B",
    );
    expect(parsed.dateColumns.map((c) => c.id)).toEqual(["b"]);
  });

  it("reports a dateColumns key that is not a list", () => {
    const { board: parsed, errors } = parseBoardFile("dateColumns: nope", "B");
    expect(parsed.dateColumns).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});
