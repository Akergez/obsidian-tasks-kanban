import type { App } from "obsidian";
import type { BoardNotes } from "./BoardNotes";

/**
 * The icon a board is marked with: the board view's own tab icon, and the same
 * glyph beside a board note in the file explorer — a board should look like a
 * board wherever it turns up.
 */
export const BOARD_ICON = "columns";

/**
 * The attribute the file explorer's rows are marked with. The icon itself is
 * drawn in styles.css: a plugin cannot hand the explorer an icon through any
 * API, so what it can do is say which rows are boards and let CSS answer.
 */
export const BOARD_ROW_ATTRIBUTE = "data-tasks-kanban";

/**
 * Marks board notes with {@link BOARD_ICON} in the file explorer.
 *
 * Tabs need no help — a board opens in the board view, which reports the icon
 * itself. The explorer has no such hook: a plugin cannot hand it an icon
 * through any API, so this marks the rows and styles.css draws them.
 *
 * The explorer is redrawn by Obsidian whenever it feels like it — folding a
 * folder, scrolling a long list, renaming a file — so this re-applies on a
 * mutation observer rather than trying to catch every occasion by event.
 * Applying is idempotent and cheap: it sets an attribute only when it differs,
 * which is also what keeps the observer from feeding itself.
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
    this.observer.observe(document.body, { childList: true, subtree: true });

    this.schedule();

    return () => {
      stopListening();
      this.observer?.disconnect();
      this.observer = null;
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

  /** Flag every board row in the file explorer; unflag everything else. */
  apply(): void {
    const rows = document.querySelectorAll<HTMLElement>(
      ".nav-file-title[data-path]",
    );

    for (const row of rows) {
      const path = row.getAttribute("data-path") ?? "";
      const isBoard = this.boards.isBoard(path);
      const marked = row.hasAttribute(BOARD_ROW_ATTRIBUTE);
      if (isBoard && !marked) {
        row.setAttribute(BOARD_ROW_ATTRIBUTE, "true");
      } else if (!isBoard && marked) {
        row.removeAttribute(BOARD_ROW_ATTRIBUTE);
      }
    }
  }
}
