import { describe, it, expect, vi, beforeEach } from "vitest";
import { Menu } from "obsidian";
import { KanbanCard } from "../src/components/KanbanCard";
import { buildBoardActions } from "../src/utils/boardActions";
import type { Task } from "../src/services/TasksIntegration";

/** The stub Menu from tests/setup.ts, which records what a card offered. */
const MenuStub = Menu as unknown as {
  lastMenu: {
    items: { title: string; clickHandler: (() => void) | null }[];
    shownAt: unknown;
  } | null;
};

const TASK: Task = {
  id: "t1",
  status: { symbol: " ", name: "Todo", type: "TODO" },
  description: "A todo task",
  tags: [],
  priority: null,
  dueDate: null,
  startDate: null,
  scheduledDate: null,
  doneDate: null,
  createdDate: null,
  cancelledDate: null,
  recurrence: null,
  dependsOn: [],
  taskLocation: { path: "notes.md", lineNumber: 3 },
  originalMarkdown: "- [ ] A todo task",
};

const ACTIONS = buildBoardActions([
  { id: "a1", title: "Next week", mutation: "clear scheduled date" },
  { id: "a2", title: "Done", mutation: "set done" },
]);

function mockIntegration() {
  return {
    app: { vault: { getFileByPath: () => null } },
    getTasks: () => [TASK],
    taskUpdater: { applyMutation: vi.fn().mockResolvedValue(true) },
  };
}

/** Render a card and right-click it; returns the integration and the event. */
function rightClick(actions = ACTIONS) {
  const container = document.createElement("div");
  const integration = mockIntegration();
  const card = new KanbanCard(
    container,
    TASK,
    integration as never,
    undefined,
    [],
    actions,
  );
  card.render();
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  container.dispatchEvent(event);
  return { integration, event, card };
}

describe("KanbanCard: the right-click action menu", () => {
  beforeEach(() => {
    MenuStub.lastMenu = null;
  });

  it("offers one item per board action, in order", () => {
    rightClick();
    expect(MenuStub.lastMenu?.items.map((i) => i.title)).toEqual([
      "Next week",
      "Done",
    ]);
  });

  it("shows the menu where the click happened", () => {
    const { event } = rightClick();
    expect(MenuStub.lastMenu?.shownAt).toBe(event);
  });

  it("suppresses the default menu when it has something to offer", () => {
    const { event } = rightClick();
    expect(event.defaultPrevented).toBe(true);
  });

  it("runs that action's mutation against this task", () => {
    const { integration } = rightClick();
    MenuStub.lastMenu?.items[1].clickHandler?.();
    expect(integration.taskUpdater.applyMutation).toHaveBeenCalledWith(
      TASK,
      ACTIONS[1].mutation,
    );
  });

  it("stays out of the way when the board configures no actions", () => {
    const { event } = rightClick([]);
    expect(MenuStub.lastMenu).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it("stops offering actions once the card is destroyed", () => {
    const container = document.createElement("div");
    const integration = mockIntegration();
    const card = new KanbanCard(
      container,
      TASK,
      integration as never,
      undefined,
      [],
      ACTIONS,
    );
    card.render();
    card.destroy();
    container.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    expect(MenuStub.lastMenu).toBeNull();
  });
});
