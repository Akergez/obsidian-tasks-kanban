import { describe, it, expect } from "vitest";
import { DEFAULT_WEEKLY_NOTE } from "../src/query/weeklyNote";
import { templateVariables } from "../src/query/template";
import { findBoardBlock } from "../src/query/markdownBoard";
import { parseBoardFile, serializeBoardFile } from "../src/query/boardFile";
import { buildMetaColumns } from "../src/utils/metaColumns";
import { buildBoardActions } from "../src/utils/boardActions";
import { columnCollects } from "../src/utils/columnMatch";
import { renderWeek, weekVariables } from "../src/utils/weeklyBoard";
import type { Task } from "../src/services/TasksIntegration";

/** A local-midnight Date for a `YYYY-MM-DD` day. */
function day(iso: string): Date {
  const [year, month, date] = iso.split("-").map(Number);
  return new Date(year, month - 1, date);
}

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

/** The board the default note carries, exactly as it is stored. */
function storedBoard() {
  const block = findBoardBlock(DEFAULT_WEEKLY_NOTE);
  expect(block).not.toBeNull();
  const { board, errors } = parseBoardFile(block!.body, "fallback");
  expect(errors).toEqual([]);
  return board;
}

describe("the default weekly note", () => {
  it("is a week board that names no week", () => {
    const board = storedBoard();
    expect(board.boardType).toBe("week");
    expect(board.name).toBe("Weekly");
    expect(board.noDateColumn).toBe(false);
    // The days are built at render time, so the file holds none — which is what
    // lets this one note be the board for every week.
    expect(board.dateColumns).toEqual([]);
  });

  it("keeps its placeholders in the file", () => {
    expect(storedBoard().metaColumns[0].filter).toContain("{{monday}}");
    expect(storedBoard().actions[0].mutation).toContain("{{nextWeek}}");
  });

  it("asks only for variables the plugin provides", () => {
    const known = Object.keys(weekVariables(day("2026-08-24")));
    const board = storedBoard();
    const templated = [
      ...board.metaColumns.flatMap((c) => [c.filter, c.mutation]),
      ...board.actions.map((a) => a.mutation),
      board.cardColors,
    ].join("\n");
    for (const name of templateVariables(templated)) {
      expect(known).toContain(name);
    }
  });

  it("survives a round trip through the board file format", () => {
    const board = storedBoard();
    const again = parseBoardFile(serializeBoardFile(board), "fallback");
    expect(again.errors).toEqual([]);
    expect(again.board).toEqual(board);
  });

  describe("rendered for a week", () => {
    const monday = day("2026-08-24");
    const board = storedBoard();
    const pool = buildMetaColumns(
      board.metaColumns.map((column) => ({
        ...column,
        filter: renderWeek(column.filter, monday),
        mutation: renderWeek(column.mutation, monday),
      })),
    )[0];

    it("pools that week's unplanned work, and only that week's", () => {
      expect(columnCollects(pool, task())).toBe(true);
      expect(columnCollects(pool, task({ tags: ["#w35_2026"] }))).toBe(true);
      expect(columnCollects(pool, task({ tags: ["#w36_2026"] }))).toBe(false);
      expect(columnCollects(pool, task({ scheduledDate: "2026-08-26" }))).toBe(
        false,
      );
    });

    it("offers Next week, Cancel and Done", () => {
      const actions = buildBoardActions(
        board.actions.map((action) => ({
          ...action,
          mutation: renderWeek(action.mutation, monday),
        })),
      );
      expect(actions.map((a) => a.title)).toEqual([
        "Next week",
        "Cancel",
        "Done",
      ]);
      expect(actions[0].mutation).toEqual([
        { kind: "clear-date", field: "scheduledDate" },
        { kind: "tag", value: "w35_2026", remove: true },
        { kind: "tag", value: "w36_2026", remove: false },
      ]);
    });

    it("hands the last week of a year to the first of the next", () => {
      const actions = buildBoardActions(
        board.actions.map((action) => ({
          ...action,
          mutation: renderWeek(action.mutation, day("2026-12-28")),
        })),
      );
      expect(actions[0].mutation).toContainEqual({
        kind: "tag",
        value: "w1_2027",
        remove: false,
      });
    });

    it("matches an unpadded tag from a single-digit week", () => {
      const early = buildMetaColumns(
        board.metaColumns.map((column) => ({
          ...column,
          filter: renderWeek(column.filter, day("2026-01-26")),
        })),
      )[0];
      expect(columnCollects(early, task({ tags: ["#w5_2026"] }))).toBe(true);
      expect(columnCollects(early, task({ tags: ["#w6_2026"] }))).toBe(false);
    });
  });
});
