import { TFile, TFolder, normalizePath, type App } from "obsidian";
import {
  emptyBoardFile,
  parseBoardFile,
  serializeBoardFile,
  type BoardFile,
} from "../query/boardFile";
import { boardNote, findBoardBlock } from "../query/markdownBoard";

/** Boards are ordinary notes, so this is the extension they carry. */
export const BOARD_EXTENSION = "md";

/** A board file discovered in the vault. */
export interface BoardEntry {
  /** Vault-relative path, which is also the board's identity. */
  path: string;
  /** Display name (the file's `name:` key, or its base name). */
  name: string;
}

/** The file's base name without the `.md` extension. */
export function boardNameFromPath(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(new RegExp(`\\.${BOARD_EXTENSION}$`, "i"), "");
}

/**
 * The path a board called `name` has inside `folder` ("" ⇒ the vault root).
 *
 * Unlike {@link BoardRepository.create}, this does not dodge a collision — it
 * is for boards whose name *is* their identity (the weekly planner), where
 * landing on the existing file is the point.
 */
export function boardPath(folder: string, name: string): string {
  const file = `${sanitizeFileName(name) || "Board"}.${BOARD_EXTENSION}`;
  const trimmed = folder.trim();
  return trimmed === "" ? file : `${normalizePath(trimmed)}/${file}`;
}

/**
 * Reads and writes the board notes in the vault.
 *
 * A board is a ```tasks-kanban block inside an ordinary note, so the vault, not
 * this plugin, owns the file: it can be moved, renamed, synced and versioned
 * like anything else, and edited in Obsidian's own editor. This is the only
 * place that knows how boards map onto the vault. An open board writes itself
 * (see components/BoardBlock, which owns its own block) — this repository
 * serves the picker and the commands, which touch boards that aren't open.
 */
export class BoardRepository {
  private readonly app: App;
  /** Returns the configured boards folder; read live so a settings change applies. */
  private readonly getFolder: () => string;

  constructor(app: App, getFolder: () => string) {
    this.app = app;
    this.getFolder = getFolder;
  }

  /** The configured folder, normalised; "" means the vault root. */
  folderPath(): string {
    const folder = this.getFolder().trim();
    return folder === "" ? "" : normalizePath(folder);
  }

  /**
   * Every note under the configured folder, sorted by name.
   *
   * The folder is the convention: what the plugin writes there is a board, and
   * a note put there is offered as one. Proving it — reading each file to look
   * for the block — would make listing async and the picker slow, for a
   * distinction the folder already draws.
   */
  list(): BoardEntry[] {
    const folder = this.folderPath();
    const prefix = folder === "" ? "" : `${folder}/`;

    return this.app.vault
      .getFiles()
      .filter(
        (file) =>
          file.extension.toLowerCase() === BOARD_EXTENSION &&
          file.path.startsWith(prefix),
      )
      .map((file) => ({
        path: file.path,
        name: boardNameFromPath(file.path),
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
  }

  /** Read and parse one board, or undefined when the path is not a board file. */
  async read(
    path: string,
  ): Promise<{ board: BoardFile; errors: string[] } | undefined> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return undefined;
    }
    const content = await this.app.vault.read(file);
    const block = findBoardBlock(content);
    if (!block) {
      return undefined;
    }
    return parseBoardFile(block.body, boardNameFromPath(path));
  }

  /** Write a whole note, creating it (and its folder) if it is not there yet. */
  async writeNote(path: string, content: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
      return;
    }
    await this.ensureFolder(path);
    await this.app.vault.create(path, content);
  }

  /** Write a board as a note of its own: a heading, then the board's block. */
  async write(path: string, board: BoardFile): Promise<void> {
    await this.writeNote(
      path,
      boardNote(board.name, serializeBoardFile(board)),
    );
  }

  /**
   * Make sure a note exists at `path`, writing `content` there when it does
   * not. An existing file is left exactly as it is — this is how reopening the
   * weekly planner returns the board with the week's edits still on it, rather
   * than a fresh one. Returns whether the file had to be created.
   */
  async ensureNote(path: string, content: string): Promise<boolean> {
    if (this.app.vault.getAbstractFileByPath(path) instanceof TFile) {
      return false;
    }
    await this.writeNote(path, content);
    return true;
  }

  /**
   * Create a new board note named after `name`, avoiding a collision by
   * appending a counter. Returns the path of the file created.
   */
  async create(name: string): Promise<string> {
    const board = emptyBoardFile(name);
    const path = this.availablePath(name);
    await this.write(path, board);
    return path;
  }

  /** Delete a board file (no-op when it is already gone). */
  async delete(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.fileManager.trashFile(file);
    }
  }

  /** A free path in the boards folder for a board called `name`. */
  private availablePath(name: string): string {
    const folder = this.folderPath();
    const safe = sanitizeFileName(name) || "Board";
    const at = (suffix: string) => {
      const file = `${safe}${suffix}.${BOARD_EXTENSION}`;
      return folder === "" ? file : `${folder}/${file}`;
    };

    let path = at("");
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(path)) {
      counter += 1;
      path = at(` ${counter}`);
    }
    return path;
  }

  /** Create the parent folder of `path` if it isn't there yet. */
  private async ensureFolder(path: string): Promise<void> {
    const slash = path.lastIndexOf("/");
    if (slash === -1) {
      return;
    }
    const folder = path.slice(0, slash);
    const existing = this.app.vault.getAbstractFileByPath(folder);
    if (existing instanceof TFolder) {
      return;
    }
    await this.app.vault.createFolder(folder);
  }
}

/** Strip the characters a vault path cannot carry. */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
