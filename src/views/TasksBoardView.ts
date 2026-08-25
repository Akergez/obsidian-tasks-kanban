import { Notice, TextFileView, type WorkspaceLeaf } from "obsidian";

import { TasksIntegration, type Task } from "../services/TasksIntegration";
import { KanbanBoard } from "../components/KanbanBoard";
import {
  emptyBoardFile,
  parseBoardFile,
  serializeBoardFile,
  type BoardFile,
} from "../query/boardFile";
import {
  boardBlock,
  findBoardBlock,
  replaceBoardBlockBody,
} from "../query/markdownBoard";
import { boardNameFromPath } from "../services/BoardRepository";
import { BOARD_ICON } from "../services/BoardIcons";
import type {
  BoardOwnState,
  BoardStatePersistence,
} from "../types/persistence";

export const BOARD_VIEW_TYPE = "tasks-board";

/**
 * The last few failures inside a board view, kept for the diagnostics command.
 *
 * A throw in `onOpen` or `setViewData` leaves Obsidian with an empty tab and no
 * explanation anywhere the user can reach — which is exactly the "it does not
 * render" this is here to explain.
 */
export const boardViewFailures: string[] = [];

/** Record a failure, keeping only the recent ones. */
function recordFailure(where: string, error: unknown): void {
  const detail =
    error instanceof Error ? error.stack || error.message : String(error);
  boardViewFailures.push(`${where}: ${detail}`);
  if (boardViewFailures.length > 5) {
    boardViewFailures.shift();
  }
}

/** Obsidian's own view type for a note, which is what "Edit text" swaps to. */
export const MARKDOWN_VIEW_TYPE = "markdown";

/** The shared settings a board reads, whichever note it is written in. */
export interface BoardHost {
  /** The shared base query merged into every board. */
  getBaseQuery(): string;
  /** The shared card-colour rules merged into every board. */
  getBaseCardColors(): string;
  /**
   * Tell the plugin this note was sent to the markdown editor on purpose, so
   * boards-open-as-boards leaves it there until asked otherwise.
   */
  editingText?(path: string): void;
}

/**
 * The Kanban board view: a board, full screen, in its own tab.
 *
 * A board is stored as a ```tasks-kanban block inside an ordinary note, so this
 * is a {@link TextFileView} over that note — Obsidian owns reading and writing
 * the bytes, and this view owns the block. Everything else in the note (the
 * heading above it, any prose below) is carried through untouched: the view
 * replaces the block's body and nothing else.
 *
 * Boards open here rather than in the markdown editor because a board note
 * declares itself one in its frontmatter; see services/BoardNotes and the
 * swap in main.ts. The header's "Edit text" button goes the other way, handing
 * the same file to the markdown editor.
 */
export class TasksBoardView extends TextFileView {
  private tasksIntegration: TasksIntegration;
  private host: BoardHost;
  private kanbanBoard: KanbanBoard | null = null;
  private unsubscribe: (() => void) | null = null;
  /** The parsed board, or null when the note holds no block to read. */
  private board: BoardFile | null = null;
  /**
   * The note this view last read. Obsidian reuses a leaf — and with it this
   * view and its board — for the next file opened in it, so this is what tells
   * "the same board saved itself" from "a different board arrived".
   */
  private boardPath: string | null = null;
  private readonly persistence: BoardStatePersistence;

  constructor(
    leaf: WorkspaceLeaf,
    tasksIntegration: TasksIntegration,
    host: BoardHost,
  ) {
    super(leaf);
    this.tasksIntegration = tasksIntegration;
    this.host = host;
    this.persistence = {
      getBaseQuery: () => this.host.getBaseQuery(),
      getBaseCardColors: () => this.host.getBaseCardColors(),
      get: () => this.readState(),
      save: (state) => this.writeState(state),
    };
  }

  getViewType(): string {
    return BOARD_VIEW_TYPE;
  }

  getIcon(): string {
    return BOARD_ICON;
  }

  getDisplayText(): string {
    if (this.file) {
      return this.board?.name || boardNameFromPath(this.file.path);
    }
    return "Board";
  }

  /** The board's own slice, read out of the block this view last parsed. */
  private readState(): BoardOwnState {
    const board = this.board ?? emptyBoardFile("Board");
    return {
      query: board.query,
      boardType: board.boardType,
      collapsedColumns: board.collapsedColumns,
      collapsedGroups: board.collapsedGroups,
      columns: board.columns,
      metaColumns: board.metaColumns,
      actions: board.actions,
      columnTagPrefix: board.columnTagPrefix,
      columnOrder: board.columnOrder,
      dateField: board.dateField,
      dateColumns: board.dateColumns,
      noDateColumn: board.noDateColumn,
      cardColors: board.cardColors,
    };
  }

  /**
   * Persist the board's own slice: update the in-memory board, write it into
   * the note's block, and ask Obsidian to save. Folds therefore land in the
   * document alongside everything else, which is why a fold is a file write.
   */
  private writeState(state: BoardOwnState): void {
    if (!this.board) {
      return;
    }
    this.board = {
      ...this.board,
      query: state.query,
      boardType: state.boardType,
      collapsedColumns: state.collapsedColumns,
      collapsedGroups: state.collapsedGroups,
      columns: state.columns,
      metaColumns: state.metaColumns,
      actions: state.actions,
      columnTagPrefix: state.columnTagPrefix,
      columnOrder: state.columnOrder,
      dateField: state.dateField,
      dateColumns: state.dateColumns,
      noDateColumn: state.noDateColumn,
      cardColors: state.cardColors,
    };
    this.data = this.noteWithBoard();
    this.requestSave();
  }

  /**
   * The note as it should now read: the current board serialized into its
   * block, every other line as it was.
   *
   * A note that has no block yet gets one appended — that is how a board opened
   * in a note someone wrote by hand starts existing, rather than silently
   * dropping whatever the board was set to.
   */
  private noteWithBoard(): string {
    if (!this.board) {
      return this.data;
    }
    const body = serializeBoardFile(this.board);
    const block = findBoardBlock(this.data);
    if (!block) {
      const separator = this.data.trim() === "" ? "" : "\n\n";
      return `${this.data.replace(/\n+$/, "")}${separator}${boardBlock(body)}\n`;
    }
    return replaceBoardBlockBody(
      this.data,
      block.lineStart,
      block.lineEnd,
      body,
    );
  }

  // --- TextFileView contract ---

  getViewData(): string {
    return this.data;
  }

  setViewData(data: string, clear: boolean): void {
    try {
      this.readViewData(data, clear);
    } catch (error) {
      recordFailure("setViewData", error);
      throw error;
    }
  }

  private readViewData(data: string, clear: boolean): void {
    this.data = data;
    const fallback = this.file ? boardNameFromPath(this.file.path) : "Board";
    const block = findBoardBlock(data);
    this.board = block ? parseBoardFile(block.body, fallback).board : null;

    const path = this.file?.path ?? null;
    if (path !== this.boardPath) {
      // A different note: whatever week the previous board had been paged to is
      // none of this one's business.
      this.kanbanBoard?.resetWeek();
      this.boardPath = path;
    }

    if (clear) {
      this.kanbanBoard?.reloadQueryFromPersistence();
    }
    // A file opened into an already-built board (Obsidian reuses leaves) must
    // pick up the new document rather than keep the previous board's query.
    this.kanbanBoard?.reloadQueryFromPersistence();
    this.refresh();
    this.warnIfBoardless();
  }

  clear(): void {
    this.data = "";
    this.board = null;
  }

  async onOpen() {
    try {
      await this.build();
    } catch (error) {
      recordFailure("onOpen", error);
      throw error;
    }
  }

  private async build() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tasks-kanban-view");

    // Load the vault's status configuration so columns reflect it
    // (also picks up status-config changes whenever the board is reopened).
    await this.tasksIntegration.loadStatuses();

    this.kanbanBoard = new KanbanBoard(
      contentEl,
      this.app,
      this.tasksIntegration,
      this.persistence,
      () => void this.editSource(),
    );

    this.unsubscribe = this.tasksIntegration.subscribe((tasks: Task[]) => {
      this.kanbanBoard?.updateTasks(tasks);
    });

    this.kanbanBoard.render();
    this.refresh();
  }

  /** Warn once when a note opened as a board has no block to read. */
  private warnIfBoardless(): void {
    if (this.board || !this.file) {
      return;
    }
    new Notice(
      `Tasks Kanban: ${this.file.basename} has no \`\`\`tasks-kanban block yet.`,
    );
  }

  async onClose() {
    this.contentEl.empty();

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    if (this.kanbanBoard) {
      this.kanbanBoard.destroy();
      this.kanbanBoard = null;
    }
  }

  /**
   * Hand this note to the markdown editor, in source mode: the way out of the
   * board and into the text behind it, for anything the modals do not cover.
   * The board is one command (or one reopen) away again.
   */
  private async editSource(): Promise<void> {
    if (this.file) {
      this.host.editingText?.(this.file.path);
    }
    const state = this.leaf.getViewState();
    await this.leaf.setViewState({
      ...state,
      type: MARKDOWN_VIEW_TYPE,
      state: { ...state.state, mode: "source" },
    });
    this.app.workspace.setActiveLeaf(this.leaf, { focus: true });
  }

  /**
   * Refresh the view with current tasks and query.
   */
  refresh() {
    if (this.kanbanBoard) {
      this.kanbanBoard.reloadQueryFromPersistence();
      this.kanbanBoard.updateTasks(this.tasksIntegration.getTasks());
    }
  }

  /** Whether this note holds a board block at all. */
  hasBoard(): boolean {
    return this.board !== null;
  }

  /** Whether the board component was built; for the diagnostics command. */
  isRendered(): boolean {
    return this.kanbanBoard !== null;
  }
}
