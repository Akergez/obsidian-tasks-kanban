import { setIcon, type App } from "obsidian";
import type { BoardNotes } from "./BoardNotes";

/**
 * The icon a board is marked with: the board view's own tab icon, and the same
 * glyph beside a board note in the file explorer — a board should look like a
 * board wherever it turns up.
 */
export const BOARD_ICON = "columns";

/** The class of the element this plugin adds to a board's row. */
export const BOARD_TAG_CLASS = "tasks-kanban-file-tag";

/** Also flagged on the row itself, so a theme can style board rows if it likes. */
export const BOARD_ROW_ATTRIBUTE = "data-tasks-kanban";

/**
 * Marks board notes in the file explorer.
 *
 * Obsidian has no API for a file's icon there, and no plugin has found one —
 * Excalidraw marks its own files the same way, by watching the explorer and
 * putting an element into the row. Two things are borrowed from it, and both
 * matter:
 *
 * - the mark is a `nav-file-tag`, the element Obsidian already uses for the
 *   badge on a row. It sits where the theme expects a badge, is styled by the
 *   theme, and never collides with whatever draws the row's file icon. Drawing
 *   a glyph in front of the name instead is what put the board icon *beside*
 *   the file icon rather than in place of one.
 * - the observer watches `.nav-files-container`, not the whole document.
 *
 * Tabs need no help: a board opens in the board view, which reports the icon
 * itself.
 */
export class BoardIcons {
  private readonly app: App;
  private readonly boards: BoardNotes;
  private observer: MutationObserver | null = null;
  private scheduled = false;

  constructor(app: App, boards: BoardNotes) {
    this.app = app;
    this.boards = boards;
  }

  /** Start marking, and keep it up to date. Returns a function that stops. */
  start(): () => void {
    const stopListening = this.boards.onChange(() => this.schedule());
    this.observer = new MutationObserver(() => this.schedule());

    // The explorer may not exist yet (or may be rebuilt), so the observer is
    // re-attached whenever the layout settles.
    const attach = () => {
      const container = document.querySelector(".nav-files-container");
      if (container && this.observer) {
        this.observer.disconnect();
        this.observer.observe(container, { childList: true, subtree: true });
      }
      this.schedule();
    };

    const layoutRef = this.app.workspace.on("layout-change", attach);
    this.app.workspace.onLayoutReady(attach);
    attach();

    return () => {
      stopListening();
      this.app.workspace.offref(layoutRef);
      this.observer?.disconnect();
      this.observer = null;
      this.clear();
    };
  }

  /** Coalesce the many reasons to re-apply into one pass per frame. */
  private schedule(): void {
    if (this.scheduled) {
      return;
    }
    this.scheduled = true;
    window.requestAnimationFrame(() => {
      this.scheduled = false;
      this.apply();
    });
  }

  /** Mark every board row in the file explorer; unmark everything else. */
  apply(): void {
    const rows = document.querySelectorAll<HTMLElement>(
      ".nav-file-title[data-path]",
    );

    for (const row of rows) {
      const path = row.getAttribute("data-path") ?? "";
      if (this.boards.isBoard(path)) {
        this.mark(row);
      } else {
        this.unmark(row);
      }
    }
  }

  /** Give a row the board badge, once. */
  private mark(row: HTMLElement): void {
    if (!row.hasAttribute(BOARD_ROW_ATTRIBUTE)) {
      row.setAttribute(BOARD_ROW_ATTRIBUTE, "true");
    }
    if (row.querySelector(`.${BOARD_TAG_CLASS}`)) {
      return;
    }

    const tag = row.createDiv({ cls: `nav-file-tag ${BOARD_TAG_CLASS}` });
    tag.setAttribute("aria-label", "Kanban board");
    setIcon(tag, BOARD_ICON);
  }

  /** Take the badge off a row that is not (or is no longer) a board. */
  private unmark(row: HTMLElement): void {
    row.removeAttribute(BOARD_ROW_ATTRIBUTE);
    row.querySelector(`.${BOARD_TAG_CLASS}`)?.remove();
  }

  /** Remove every badge, when the plugin unloads. */
  private clear(): void {
    for (const tag of document.querySelectorAll(`.${BOARD_TAG_CLASS}`)) {
      tag.remove();
    }
    for (const row of document.querySelectorAll(`[${BOARD_ROW_ATTRIBUTE}]`)) {
      row.removeAttribute(BOARD_ROW_ATTRIBUTE);
    }
  }
}
