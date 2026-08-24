import { describe, it, expect } from "vitest";
import {
  WEEKDAY_TITLES,
  buildWeeklyBoard,
  isoWeekName,
  startOfWeek,
  weekDays,
} from "../src/utils/weeklyBoard";
import { boardPath } from "../src/services/BoardRepository";
import { serializeBoardFile, parseBoardFile } from "../src/query/boardFile";

/** A local-midnight Date for a `YYYY-MM-DD` day. */
function day(iso: string): Date {
  const [year, month, date] = iso.split("-").map(Number);
  return new Date(year, month - 1, date);
}

describe("startOfWeek", () => {
  it("returns the Monday of that week", () => {
    // 2026-08-26 is a Wednesday.
    expect(startOfWeek(day("2026-08-26"))).toEqual(day("2026-08-24"));
  });

  it("is a no-op on a Monday", () => {
    expect(startOfWeek(day("2026-08-24"))).toEqual(day("2026-08-24"));
  });

  it("puts Sunday in the week that just ended, not the one starting", () => {
    // The Monday-start rule: 2026-08-30 is a Sunday.
    expect(startOfWeek(day("2026-08-30"))).toEqual(day("2026-08-24"));
  });

  it("crosses a month and a year boundary", () => {
    expect(startOfWeek(day("2026-01-01"))).toEqual(day("2025-12-29"));
  });

  it("drops the time of day", () => {
    expect(startOfWeek(new Date(2026, 7, 26, 23, 45))).toEqual(
      day("2026-08-24"),
    );
  });
});

describe("isoWeekName", () => {
  it("names an ordinary week", () => {
    expect(isoWeekName(day("2026-08-24"))).toBe("2026-W35");
  });

  it("zero-pads a single-digit week", () => {
    expect(isoWeekName(day("2026-01-05"))).toBe("2026-W02");
  });

  it("gives a January week to the year its Thursday is in", () => {
    // 2026-01-01 is a Thursday, so its week is 2026-W01 — and that week
    // started back in December.
    expect(isoWeekName(day("2025-12-29"))).toBe("2026-W01");
  });

  it("gives a January week to the previous year when it belongs there", () => {
    // 2027-01-01 is a Friday, so its week is still 2026-W53.
    expect(isoWeekName(startOfWeek(day("2027-01-01")))).toBe("2026-W53");
  });

  it("agrees with ISO on a 53-week year", () => {
    expect(isoWeekName(day("2026-12-28"))).toBe("2026-W53");
  });

  it("names consecutive weeks consecutively across a whole year", () => {
    let monday = startOfWeek(day("2026-01-15"));
    const seen: string[] = [];
    for (let i = 0; i < 52; i += 1) {
      seen.push(isoWeekName(monday));
      monday = new Date(
        monday.getFullYear(),
        monday.getMonth(),
        monday.getDate() + 7,
      );
    }
    expect(new Set(seen).size).toBe(52);
  });
});

describe("weekDays", () => {
  it("lists the seven days from Monday", () => {
    expect(weekDays(day("2026-08-24"))).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
    ]);
  });

  it("rolls over a month end", () => {
    expect(weekDays(day("2026-08-31"))).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
  });
});

describe("buildWeeklyBoard", () => {
  const board = buildWeeklyBoard(day("2026-08-24"), "scheduledDate");

  it("is a date board named after its ISO week", () => {
    expect(board.name).toBe("2026-W35");
    expect(board.boardType).toBe("date");
    expect(board.dateField).toBe("scheduledDate");
  });

  it("has one column per weekday, Monday first", () => {
    expect(board.dateColumns.map((c) => c.title)).toEqual(WEEKDAY_TITLES);
    expect(board.dateColumns[0].date).toBe("2026-08-24");
    expect(board.dateColumns[6].date).toBe("2026-08-30");
  });

  it("derives column ids from the day, so the file is reproducible", () => {
    expect(buildWeeklyBoard(day("2026-08-24"), "scheduledDate")).toEqual(board);
    expect(board.dateColumns[0].id).toBe("date:2026-08-24");
  });

  it("uses the field it is given", () => {
    expect(buildWeeklyBoard(day("2026-08-24"), "dueDate").dateField).toBe(
      "dueDate",
    );
  });

  it("round-trips through the board file format", () => {
    const { board: parsed, errors } = parseBoardFile(
      serializeBoardFile(board),
      "fallback",
    );
    expect(errors).toEqual([]);
    expect(parsed).toEqual(board);
  });

  it("lands on the same path for the same week", () => {
    expect(boardPath("Kanban/Weekly", board.name)).toBe(
      "Kanban/Weekly/2026-W35.kanban",
    );
  });
});

describe("boardPath", () => {
  it("puts a board in the vault root for an empty folder", () => {
    expect(boardPath("", "2026-W35")).toBe("2026-W35.kanban");
    expect(boardPath("   ", "2026-W35")).toBe("2026-W35.kanban");
  });

  it("strips characters a vault path cannot carry", () => {
    expect(boardPath("Kanban", "Q2: plan")).toBe("Kanban/Q2 plan.kanban");
  });

  it("falls back to a usable name when nothing survives sanitising", () => {
    expect(boardPath("Kanban", "***")).toBe("Kanban/Board.kanban");
  });
});
