import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KanbanBoard } from "../src/components/KanbanBoard";
import type {
  BoardOwnState,
  BoardStatePersistence,
} from "../src/types/persistence";

/**
 * A week board is the one board whose columns are not in its file, so what is
 * worth testing is the seam: the days follow the week you are looking at, the
 * templated fields follow it too, and none of it is ever written back.
 */

const integration = {
  getTasks: () => [],
  getStatuses: () => [{ symbol: " ", name: "Todo", type: "TODO" }],
  subscribe: () => () => {},
  taskUpdater: {},
  app: {},
} as never;

/** The stored state of a week board: templated, and naming no week. */
function weekState(overrides: Partial<BoardOwnState> = {}): BoardOwnState {
  return {
    query: "",
    boardType: "week",
    collapsedColumns: [],
    collapsedGroups: [],
    columns: [],
    metaColumns: [
      {
        id: "meta:unplanned",
        title: "Unplanned",
        filter: [
          "not done",
          "(no scheduled date) OR (scheduled before {{monday}})",
        ].join("\n"),
        mutation: "clear scheduled date",
      },
    ],
    actions: [
      {
        id: "action:next-week",
        title: "Next week",
        mutation: "add tag #w{{nextWeek}}_{{nextYear}}",
      },
    ],
    columnTagPrefix: "",
    columnOrder: "",
    dateField: "scheduledDate",
    dateColumns: [],
    noDateColumn: false,
    cardColors: "",
    ...overrides,
  };
}

/** A board rendered into a detached container, with its saves recorded. */
function board(initial: BoardOwnState = weekState()) {
  let state = initial;
  const saved: BoardOwnState[] = [];
  const persistence: BoardStatePersistence = {
    get: () => state,
    getBaseQuery: () => "",
    getBaseCardColors: () => "",
    save: (next) => {
      saved.push(next);
      state = next;
    },
  };

  const container = document.createElement("div");
  const instance = new KanbanBoard(
    container,
    {} as never,
    integration,
    persistence,
  );
  instance.render();
  return { instance, container, saved };
}

/** The column titles the board is showing, in order. */
function columnTitles(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(".tasks-kanban-column-title"),
  ).map((el) => el.textContent ?? "");
}

function weekLabel(container: HTMLElement): string {
  return container.querySelector(".tasks-kanban-week-label")?.textContent ?? "";
}

/** Click the back (0) or forward (1) arrow. */
function step(container: HTMLElement, index: 0 | 1): void {
  const buttons = container.querySelectorAll<HTMLButtonElement>(
    ".tasks-kanban-week-step",
  );
  buttons[index].click();
}

describe("KanbanBoard: a week board", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // A Wednesday, so "this week" is 2026-W35 (Mon 24 – Sun 30 August).
    vi.setSystemTime(new Date(2026, 7, 26, 9, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens on the week we are in", () => {
    const { container } = board();
    expect(weekLabel(container)).toBe("2026-W35");
    expect(columnTitles(container)).toEqual([
      "Unplanned",
      "Monday 24 Aug",
      "Tuesday 25 Aug",
      "Wednesday 26 Aug",
      "Thursday 27 Aug",
      "Friday 28 Aug",
      "Saturday 29 Aug",
      "Sunday 30 Aug",
    ]);
  });

  it("marks the column standing for today", () => {
    const { container } = board();
    const today = container.querySelector(".tasks-kanban-column-today");
    expect(
      today?.querySelector(".tasks-kanban-column-title")?.textContent,
    ).toBe("Wednesday 26 Aug");
  });

  it("pages forward and back a week at a time", () => {
    const { container } = board();

    step(container, 1);
    expect(weekLabel(container)).toBe("2026-W36");
    expect(columnTitles(container)[1]).toBe("Monday 31 Aug");
    expect(container.querySelector(".tasks-kanban-column-today")).toBeNull();

    step(container, 0);
    step(container, 0);
    expect(weekLabel(container)).toBe("2026-W34");
    expect(columnTitles(container)[1]).toBe("Monday 17 Aug");
  });

  it("comes back to this week when the label is clicked", () => {
    const { container } = board();
    step(container, 1);
    step(container, 1);
    expect(weekLabel(container)).toBe("2026-W37");

    container
      .querySelector<HTMLButtonElement>(".tasks-kanban-week-label")!
      .click();
    expect(weekLabel(container)).toBe("2026-W35");
  });

  it("renders the week into the pool's filter, and repoints it on a step", () => {
    const { instance, container } = board();
    const pool = () =>
      (
        instance as unknown as {
          resolveColumnConfigs(): { id: string; filters?: unknown }[];
        }
      ).resolveColumnConfigs()[0];

    expect(JSON.stringify(pool().filters)).toContain("2026-08-24");
    step(container, 1);
    expect(JSON.stringify(pool().filters)).toContain("2026-08-31");
  });

  it("renders the week into a card action", () => {
    const { instance, container } = board();
    const actions = () =>
      (instance as unknown as { actions: { mutation: unknown[] }[] }).actions;

    expect(actions()[0].mutation).toEqual([
      { kind: "tag", value: "w36_2026", remove: false },
    ]);
    step(container, 1);
    expect(actions()[0].mutation).toEqual([
      { kind: "tag", value: "w37_2026", remove: false },
    ]);
  });

  it("never writes the week it is showing back to the file", () => {
    const { container, saved } = board();
    step(container, 1);
    step(container, 1);
    step(container, 0);
    expect(saved).toEqual([]);

    // A fold does write — and still carries the stored text, placeholders and
    // all, rather than the week that happens to be on screen.
    container
      .querySelector<HTMLElement>(".tasks-kanban-column-header")!
      .click();
    expect(saved).toHaveLength(1);
    expect(saved[0].dateColumns).toEqual([]);
    expect(saved[0].metaColumns[0].filter).toContain("{{monday}}");
    expect(saved[0].actions[0].mutation).toContain("{{nextWeek}}");
  });

  it("folds a weekday by its weekday, so paging keeps it folded", () => {
    const { container, saved } = board();
    const saturday = Array.from(
      container.querySelectorAll<HTMLElement>(".tasks-kanban-column"),
    ).find(
      (el) =>
        el.querySelector(".tasks-kanban-column-title")?.textContent ===
        "Saturday 29 Aug",
    )!;
    saturday.querySelector<HTMLElement>(".tasks-kanban-column-header")!.click();
    expect(saved[0].collapsedColumns).toEqual(["week:saturday"]);

    step(container, 1);
    const next = Array.from(
      container.querySelectorAll<HTMLElement>(".tasks-kanban-column"),
    ).find(
      (el) =>
        el.querySelector(".tasks-kanban-column-title")?.textContent ===
        "Saturday 5 Sep",
    )!;
    expect(next.classList.contains("tasks-kanban-column-collapsed")).toBe(true);
  });

  it("shows no navigator on any other kind of board", () => {
    const { container } = board(weekState({ boardType: "status" }));
    const bar = container.querySelector<HTMLElement>(".tasks-kanban-week");
    expect(bar?.style.display).toBe("none");
  });
});
