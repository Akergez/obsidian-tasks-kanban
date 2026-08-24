import { TFile, TFolder, normalizePath, type App } from "obsidian";
import {
  BOARD_EXTENSION,
  emptyBoardFile,
  parseBoardFile,
  serializeBoardFile,
  type BoardFile,
} from "../query/boardFile";

/** A board file discovered in the vault. */
export interface BoardEntry {
  /** Vault-relative path, which is also the board's identity. */
  path: string;
  /** Display name (the file's `name:` key, or its base name). */
  name: string;
}

/** The file's base name without the `.kanban` extension. */
export function boardNameFromPath(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(new RegExp(`\\.${BOARD_EXTENSION}$`, "i"), "");
}

/**
 * Reads and writes the `.kanban` board documents in the vault.
 *
 * Boards live as files the user can move, rename, sync and version like any
 * other note; this is the only place that knows how they map onto the vault.
 * The open board itself is written by its view (see {@link TasksBoardView},
 * which is a TextFileView and owns its file) — this repository serves the
 * settings pane and the board picker, which touch boards that aren't open.
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

  /** Every board file under the configured folder, sorted by name. */
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
    return parseBoardFile(content, boardNameFromPath(path));
  }

  /** Write a board back to its file, creating it if it does not exist yet. */
  async write(path: string, board: BoardFile): Promise<void> {
    const content = serializeBoardFile(board);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
      return;
    }
    await this.ensureFolder(path);
    await this.app.vault.create(path, content);
  }

  /**
   * Create a new board file named after `name`, avoiding a collision by
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
