import type { App } from "obsidian";

/**
 * The frontmatter key a note declares itself a board with.
 *
 * Needed because a fenced block is invisible to Obsidian's metadata cache: it
 * records that a note has a code section but not what language it is in, so
 * telling boards from ordinary notes would otherwise mean reading every file in
 * the vault. A one-line declaration is cheap, survives a restart, and is
 * something a user can add by hand to a board they wrote themselves.
 */
export const BOARD_FRONTMATTER_KEY = "tasks-kanban";

/** The frontmatter block the plugin writes above a board it creates. */
export const BOARD_FRONTMATTER = `---\n${BOARD_FRONTMATTER_KEY}: true\n---\n\n`;

/**
 * Which notes in the vault are boards.
 *
 * Two ways in, and both matter: the declaration above (what the plugin writes,
 * and what survives a restart) and having actually rendered a board this
 * session (what catches a block someone pasted into a note without declaring
 * anything). The second is why the answer can change without the file changing,
 * and why {@link onChange} exists.
 */
export class BoardNotes {
  private readonly app: App;
  /** Paths a board block has rendered from since the plugin loaded. */
  private readonly rendered = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(app: App) {
    this.app = app;
  }

  /** Whether the note at `path` is a board. */
  isBoard(path: string): boolean {
    if (this.rendered.has(path)) {
      return true;
    }
    const frontmatter = this.app.metadataCache.getCache(path)?.frontmatter;
    return frontmatter?.[BOARD_FRONTMATTER_KEY] === true;
  }

  /** Record that a board rendered from `path`; notifies when that is news. */
  remember(path: string): void {
    if (this.rendered.has(path)) {
      return;
    }
    this.rendered.add(path);
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Subscribe to changes in what counts as a board. Returns an unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
