import { TFile, type App } from "obsidian";
import { BOARD_FRONTMATTER_KEY, findBoardBlock } from "../query/markdownBoard";

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
  /**
   * Notes known to hold a board this session.
   *
   * Only a cache in front of the declaration in the file: a note recognised by
   * its content has one written into it (see {@link declare}), so this set is
   * how the answer is known between recognising the note and the metadata cache
   * catching up — not a registry the plugin keeps on the side.
   */
  private readonly known = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Whether the note at `path` is a board, answered without touching the disk:
   * for the file explorer, which asks about every visible row on every redraw.
   *
   * Says no for a note the metadata cache has not caught up with yet — which is
   * exactly the case right after the plugin writes one, and why opening a board
   * never goes through here (see {@link isBoardFile}).
   */
  isBoard(path: string): boolean {
    if (this.known.has(path)) {
      return true;
    }
    const frontmatter = this.app.metadataCache.getCache(path)?.frontmatter;
    return frontmatter?.[BOARD_FRONTMATTER_KEY] === true;
  }

  /**
   * Whether `file` is a board, reading it if it must.
   *
   * The authority, and what deciding to *open* a board goes through: the
   * metadata cache lags a file that was just written, so a freshly created
   * planner would otherwise open as a plain note. Reading is cached by Obsidian
   * and happens once per file opened, which is nothing.
   *
   * A note counts when it declares itself in frontmatter **or** simply carries
   * a board block — a block someone pasted in is a board too.
   */
  async isBoardFile(file: TFile): Promise<boolean> {
    if (this.isBoard(file.path)) {
      return true;
    }
    if (!(file instanceof TFile) || file.extension !== "md") {
      return false;
    }
    const content = await this.app.vault.cachedRead(file);
    const isBoard = findBoardBlock(content) !== null;
    if (isBoard) {
      // Recognised by its content: say so in the file, once, so nothing has to
      // read it again to know.
      await this.declare(file);
    }
    return isBoard;
  }

  /** Record that a board was opened from `path`; notifies when that is news. */
  remember(path: string): void {
    if (this.known.has(path)) {
      return;
    }
    this.known.add(path);
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Write the declaration into the note itself, so it opens as a board from now
   * on — including after a restart, and including on another device.
   *
   * The note is where this belongs: a list of paths kept in the plugin's own
   * data would be a second copy of what the file can say for itself, and would
   * go stale the moment the file is moved by anything but Obsidian.
   * `processFrontMatter` edits the frontmatter and nothing else.
   */
  async declare(file: TFile): Promise<void> {
    this.remember(file.path);
    if (
      this.app.metadataCache.getCache(file.path)?.frontmatter?.[
        BOARD_FRONTMATTER_KEY
      ] === true
    ) {
      return;
    }
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter[BOARD_FRONTMATTER_KEY] = true;
    });
  }

  /** Subscribe to changes in what counts as a board. Returns an unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
