import { describe, it, expect } from "vitest";
import { renderTemplate, templateVariables } from "../src/query/template";
import {
  DEFAULT_WEEKLY_TEMPLATE,
  renderWeeklyTemplate,
} from "../src/query/weeklyTemplate";
import { findBoardBlock } from "../src/query/markdownBoard";
import { parseBoardFile } from "../src/query/boardFile";
import { buildMetaColumns } from "../src/utils/metaColumns";
import { buildBoardActions } from "../src/utils/boardActions";
import { columnCollects } from "../src/utils/columnMatch";
import { weekVariables } from "../src/utils/weeklyBoard";
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

describe("renderTemplate", () => {
  it("substitutes what it knows", () => {
    const { text, errors } = renderTemplate("week {{week}} of {{year}}", {
      week: "35",
      year: "2026",
    });
    expect(text).toBe("week 35 of 2026");
    expect(errors).toEqual([]);
  });

  it("leaves an unknown placeholder standing, and says so", () => {
    const { text, errors } = renderTemplate("{{mondey}}", { monday: "x" });
    expect(text).toBe("{{mondey}}");
    expect(errors).toEqual([
      "Unknown template variable {{mondey}} (available: monday)",
    ]);
  });

  it("reports each unknown name once", () => {
    const { errors } = renderTemplate("{{a}} {{a}} {{b}}", {});
    expect(errors).toHaveLength(2);
  });

  it("leaves a regex quantifier alone — {4} is not a placeholder", () => {
    const { text, errors } = renderTemplate(String.raw`/^#w\d+_\d{4}$/`, {});
    expect(text).toBe(String.raw`/^#w\d+_\d{4}$/`);
    expect(errors).toEqual([]);
  });

  it("does not re-scan what it substituted", () => {
    const { text } = renderTemplate("{{a}}", { a: "{{b}}", b: "no" });
    expect(text).toBe("{{b}}");
  });

  it("lists the placeholders a template uses", () => {
    expect(templateVariables("{{monday}} {{week}} {{monday}}")).toEqual([
      "monday",
      "week",
    ]);
  });
});

describe("the default weekly template", () => {
  const monday = day("2026-08-24");
  const rendered = renderWeeklyTemplate(DEFAULT_WEEKLY_TEMPLATE, monday);

  it("asks only for variables the plugin provides", () => {
    const known = Object.keys(weekVariables(monday));
    for (const name of templateVariables(DEFAULT_WEEKLY_TEMPLATE)) {
      expect(known).toContain(name);
    }
    expect(rendered.errors).toEqual([]);
  });

  it("renders a note whose block parses as a board", () => {
    const block = findBoardBlock(rendered.text);
    expect(block).not.toBeNull();
    const { board, errors } = parseBoardFile(block!.body, "fallback");
    expect(errors).toEqual([]);
    expect(board.name).toBe("2026-W35");
    expect(board.boardType).toBe("date");
    expect(board.noDateColumn).toBe(false);
    expect(board.dateColumns.map((c) => c.date)).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
    ]);
  });

  function boardOf(text: string) {
    return parseBoardFile(findBoardBlock(text)!.body, "fallback").board;
  }

  it("pools this week's unplanned work, and only this week's", () => {
    const [pool] = buildMetaColumns(boardOf(rendered.text).metaColumns);
    expect(columnCollects(pool, task())).toBe(true);
    expect(columnCollects(pool, task({ tags: ["#w35_2026"] }))).toBe(true);
    expect(columnCollects(pool, task({ tags: ["#w36_2026"] }))).toBe(false);
    expect(columnCollects(pool, task({ scheduledDate: "2026-08-26" }))).toBe(
      false,
    );
  });

  it("offers Next week, Cancel and Done", () => {
    const actions = buildBoardActions(boardOf(rendered.text).actions);
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
    const last = renderWeeklyTemplate(
      DEFAULT_WEEKLY_TEMPLATE,
      day("2026-12-28"),
    );
    const actions = buildBoardActions(boardOf(last.text).actions);
    expect(actions[0].mutation).toContainEqual({
      kind: "tag",
      value: "w1_2027",
      remove: false,
    });
    expect(boardOf(last.text).name).toBe("2026-W53");
  });

  it("pads the week number in the board's name but not in the tag", () => {
    const early = renderWeeklyTemplate(
      DEFAULT_WEEKLY_TEMPLATE,
      day("2026-01-26"),
    );
    const board = boardOf(early.text);
    expect(board.name).toBe("2026-W05");
    expect(board.metaColumns[0].filter).toContain("#w0*5_2026");
  });
});
