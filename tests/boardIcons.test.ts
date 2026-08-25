import { describe, it, expect, vi } from "vitest";
import {
  BOARD_ROW_ATTRIBUTE,
  BOARD_TAG_CLASS,
  BoardIcons,
} from "../src/services/BoardIcons";

/** A file explorer holding one row per path. */
function explorer(paths: string[]): HTMLElement {
  document.body.empty();
  const container = document.body.createDiv({ cls: "nav-files-container" });
  for (const path of paths) {
    const row = container.createDiv({ cls: "nav-file-title" });
    row.setAttribute("data-path", path);
    // What a theme or an icon plugin puts there; the badge must not disturb it.
    row.createDiv({ cls: "nav-file-icon" });
    row.createDiv({ cls: "tree-item-inner nav-file-title-content" });
  }
  return container;
}

/** BoardIcons over a fixed set of board paths. */
function icons(boards: string[]) {
  const app = {
    workspace: {
      on: vi.fn(() => ({})),
      offref: vi.fn(),
      onLayoutReady: vi.fn(),
    },
  };
  return new BoardIcons(
    app as never,
    {
      isBoard: (path: string) => boards.includes(path),
      onChange: () => () => {},
    } as never,
  );
}

const row = (path: string) =>
  document.querySelector<HTMLElement>(`.nav-file-title[data-path="${path}"]`)!;

describe("BoardIcons", () => {
  it("badges a board row and leaves other rows alone", () => {
    explorer(["Kanban/Sprint.md", "Notes/Diary.md"]);
    icons(["Kanban/Sprint.md"]).apply();

    expect(
      row("Kanban/Sprint.md").querySelector(`.${BOARD_TAG_CLASS}`),
    ).not.toBeNull();
    expect(
      row("Notes/Diary.md").querySelector(`.${BOARD_TAG_CLASS}`),
    ).toBeNull();
  });

  it("uses Obsidian's own row badge, so it cannot collide with a file icon", () => {
    explorer(["Kanban/Sprint.md"]);
    icons(["Kanban/Sprint.md"]).apply();

    const badge = row("Kanban/Sprint.md").querySelector(`.${BOARD_TAG_CLASS}`);
    expect(badge?.classList.contains("nav-file-tag")).toBe(true);
    // The icon the theme drew is still there, untouched.
    const fileIcon =
      row("Kanban/Sprint.md").querySelector<HTMLElement>(".nav-file-icon");
    expect(fileIcon?.style.display).toBe("");
  });

  it("flags the row too, for themes that want to style it", () => {
    explorer(["Kanban/Sprint.md"]);
    icons(["Kanban/Sprint.md"]).apply();
    expect(row("Kanban/Sprint.md").getAttribute(BOARD_ROW_ATTRIBUTE)).toBe(
      "true",
    );
  });

  it("adds one badge however many times it runs", () => {
    explorer(["Kanban/Sprint.md"]);
    const service = icons(["Kanban/Sprint.md"]);
    service.apply();
    service.apply();
    service.apply();

    expect(
      row("Kanban/Sprint.md").querySelectorAll(`.${BOARD_TAG_CLASS}`),
    ).toHaveLength(1);
  });

  it("takes the badge back off when a note stops being a board", () => {
    explorer(["Kanban/Sprint.md"]);
    icons(["Kanban/Sprint.md"]).apply();
    icons([]).apply();

    expect(
      row("Kanban/Sprint.md").querySelector(`.${BOARD_TAG_CLASS}`),
    ).toBeNull();
    expect(row("Kanban/Sprint.md").hasAttribute(BOARD_ROW_ATTRIBUTE)).toBe(
      false,
    );
  });
});
