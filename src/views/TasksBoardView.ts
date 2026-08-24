import { TextFileView, type WorkspaceLeaf } from "obsidian";

import { TasksIntegration, type Task } from "../services/TasksIntegration";
import { KanbanBoard } from "../components/KanbanBoard";
import {
  emptyBoardFile,
  parseBoardFile,
  serializeBoardFile,
  type BoardFile,
} from "../query/boardFile";
import { boardNameFromPath } from "../services/BoardRepository";
import type {
  BoardOwnState,
  BoardStatePersistence,
} from "../types/persistence";

export const BOARD_VIEW_TYPE = "tasks-board";

/**
 * The slice of the plugin a board view needs, kept narrow to avoid a circular
 * dependency on the plugin's concrete class.
 */
export interface BoardHost {
  /** The shared base query merged into every board. */
  getBaseQuery(): string;
  /** The shared card-colour rules merged into every board. */
  getBaseCardColors(): string;
  /** Persistence for the base board — the one view that is not a file. */
  baseBoardPersistence(): BoardStatePersistence;
}

/**
 * The Kanban board view.
 *
 * A saved board *is* a `.kanban` file: this is a {@link TextFileView}, so
 * Obsidian opens it when the file is clicked and owns reading and writing the
 * bytes. The view keeps the parsed board in memory and hands the KanbanBoard a
 * synchronous {@link BoardStatePersistence} over it, so nothing downstream had
 * to learn about files.
 *
 * Opened without a file (the "Open board" command) it shows the base board,
 * whose settings live in the plugin's data.json instead.
 */
export class TasksBoardView extends TextFileView {
  private tasksIntegration: TasksIntegration;
  private host: BoardHost;
  private kanbanBoard: KanbanBoard | null = null;
  private unsubscribe: (() => void) | null = null;
  /** The parsed board backing a file-based view; null for the base board. */
  private board: BoardFile | null = null;
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
    return "columns";
  }

  getDisplayText(): string {
    if (this.file) {
      return this.board?.name || boardNameFromPath(this.file.path);
    }
    return "Board";
  }

  /** The board's own slice, read out of whichever backing this view has. */
  private readState(): BoardOwnState {
    if (!this.board) {
      return this.host.baseBoardPersistence().get();
    }
    return {
      query: this.board.query,
      boardType: this.board.boardType,
      collapsedColumns: this.board.collapsedColumns,
      collapsedGroups: this.board.collapsedGroups,
      columns: this.board.columns,
      columnTagPrefix: this.board.columnTagPrefix,
      columnOrder: this.board.columnOrder,
      dateField: this.board.dateField,
      dateColumns: this.board.dateColumns,
      cardColors: this.board.cardColors,
    };
  }

  /**
   * Persist the board's own slice. For a file-backed board this only updates
   * the in-memory document and asks Obsidian to save — folds therefore land in
   * the YAML alongside everything else, which is why a fold is a file write.
   */
  private writeState(state: BoardOwnState): void {
    if (!this.board) {
      void this.host.baseBoardPersistence().save(state);
      return;
    }
    this.board = {
      ...this.board,
      query: state.query,
      boardType: state.boardType,
      collapsedColumns: state.collapsedColumns,
      collapsedGroups: state.collapsedGroups,
      columns: state.columns,
      columnTagPrefix: state.columnTagPrefix,
      columnOrder: state.columnOrder,
      dateField: state.dateField,
      dateColumns: state.dateColumns,
      cardColors: state.cardColors,
    };
    this.requestSave();
  }

  // --- TextFileView contract ---

  getViewData(): string {
    return this.board ? serializeBoardFile(this.board) : this.data;
  }

  setViewData(data: string, clear: boolean): void {
    const fallback = this.file ? boardNameFromPath(this.file.path) : "Board";
    this.board = parseBoardFile(data, fallback).board;

    if (clear) {
      this.kanbanBoard?.reloadQueryFromPersistence();
    }
    // A file opened into an already-built board (Obsidian reuses leaves) must
    // pick up the new document rather than keep the previous board's query.
    this.kanbanBoard?.reloadQueryFromPersistence();
    this.refresh();
  }

  clear(): void {
    this.board = emptyBoardFile("Board");
  }

  async onOpen() {
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
    );

    this.unsubscribe = this.tasksIntegration.subscribe((tasks: Task[]) => {
      this.kanbanBoard?.updateTasks(tasks);
    });

    this.kanbanBoard.render();
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
   * Refresh the view with current tasks and query.
   */
  refresh() {
    if (this.kanbanBoard) {
      this.kanbanBoard.reloadQueryFromPersistence();
      this.kanbanBoard.updateTasks(this.tasksIntegration.getTasks());
    }
  }
}
