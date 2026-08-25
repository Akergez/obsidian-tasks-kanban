import { describe, it, expect } from "vitest";
import {
  WEEKDAY_TITLES,
  buildWeeklyBoard,
  isoWeekName,
  startOfWeek,
  unplannedColumn,
  weekDays,
  weekTag,
} from "../src/utils/weeklyBoard";
import { buildMetaColumns } from "../src/utils/metaColumns";
import { columnCollects } from "../src/utils/columnMatch";
import type { Task } from "../src/services/TasksIntegration";
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

describe("weekTag", () => {
  it("names the ISO week, unpadded, year last", () => {
    expect(weekTag(day("2026-08-24"))).toBe("#w35_2026");
  });

  it("does not pad a single-digit week", () => {
    expect(weekTag(day("2026-01-26"))).toBe("#w5_2026");
  });

  it("uses the ISO week-year, as the board name does", () => {
    const monday = startOfWeek(day("2027-01-01"));
    expect(isoWeekName(monday)).toBe("2026-W53");
    expect(weekTag(monday)).toBe("#w53_2026");
  });
});

describe("the pool's preplanning clause", () => {
  const [pool] = buildMetaColumns([
    unplannedColumn(day("2026-08-24"), "scheduledDate"),
  ]);

  const task = (tags: string[]): Task =>
    ({
      status: { symbol: " ", name: "Todo", type: "TODO" },
      description: "Test task",
      tags,
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
    }) as Task;

  it("keeps work tagged for this week", () => {
    expect(columnCollects(pool, task(["#w35_2026"]))).toBe(true);
  });

  it("accepts a padded spelling of this week", () => {
    expect(columnCollects(pool, task(["#w035_2026"]))).toBe(true);
  });

  it("drops work tagged for another week", () => {
    expect(columnCollects(pool, task(["#w36_2026"]))).toBe(false);
    expect(columnCollects(pool, task(["#w35_2027"]))).toBe(false);
    expect(columnCollects(pool, task(["#work", "#w2_2026"]))).toBe(false);
  });

  it("keeps work carrying no week tag at all", () => {
    expect(columnCollects(pool, task([]))).toBe(true);
    expect(columnCollects(pool, task(["#work", "#w_2026"]))).toBe(true);
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

  it("leads with the unplanned pool, filtered on the board's own field", () => {
    expect(board.metaColumns).toEqual([
      {
        id: "meta:unplanned",
        title: "Unplanned",
        filter: [
          "not done",
          "(no scheduled date) OR (scheduled before 2026-08-24)",
          String.raw`(tag regex matches /^#w0*35_2026$/) OR NOT (tag regex matches /^#w\d+_\d{4}$/)`,
        ].join("\n"),
        mutation: "set not done\nclear scheduled date",
      },
    ]);
  });

  it("pools against the week's own Monday, not against today", () => {
    // Otherwise the planner would empty its own earlier days as the week ran on.
    const next = buildWeeklyBoard(day("2026-08-31"), "scheduledDate");
    expect(next.metaColumns[0].filter).toContain("scheduled before 2026-08-31");
  });

  it("has no 'No date' column — the pool already holds that work", () => {
    expect(board.noDateColumn).toBe(false);
  });

  it("writes the pool against whichever date field the planner uses", () => {
    const due = buildWeeklyBoard(day("2026-08-24"), "dueDate");
    expect(due.metaColumns[0].filter).toContain(
      "(no due date) OR (due before 2026-08-24)",
    );
    expect(due.metaColumns[0].mutation).toBe("set not done\nclear due date");
  });

  it("offers Next week, Cancel and Done on a card's menu", () => {
    expect(board.actions.map((a) => a.title)).toEqual([
      "Next week",
      "Cancel",
      "Done",
    ]);
    expect(board.actions[1].mutation).toBe("set status.type CANCELLED");
    expect(board.actions[2].mutation).toBe("set done");
  });

  it("hands a task to the next week, taking it out of this one", () => {
    expect(board.actions[0].mutation).toBe(
      [
        "clear scheduled date",
        "remove tag #w35_2026",
        "add tag #w36_2026",
      ].join("\n"),
    );
  });

  it("carries the week boundary into the next year's numbering", () => {
    const last = buildWeeklyBoard(
      startOfWeek(day("2026-12-28")),
      "scheduledDate",
    );
    expect(last.name).toBe("2026-W53");
    expect(last.actions[0].mutation).toContain("add tag #w1_2027");
  });

  it("clears the planner's own date field, whichever it is", () => {
    const due = buildWeeklyBoard(day("2026-08-24"), "dueDate");
    expect(due.actions[0].mutation).toContain("clear due date");
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
