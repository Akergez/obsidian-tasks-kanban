import {
  MarkdownRenderChild,
  MarkdownView,
  TFile,
  type App,
  type MarkdownPostProcessorContext,
} from "obsidian";

import { KanbanBoard } from "./KanbanBoard";
import { TasksIntegration, type Task } from "../services/TasksIntegration";
import {
  emptyBoardFile,
  parseBoardFile,
  serializeBoardFile,
  type BoardFile,
} from "../query/boardFile";
import { replaceBoardBlockBody } from "../query/markdownBoard";
import type {
  BoardOwnState,
  BoardStatePersistence,
} from "../types/persistence";

/** The shared settings a board reads, whichever note it is written in. */
export interface BoardBlockHost {
  /** The shared base query merged into every board. */
  getBaseQuery(): string;
  /** The shared card-colour rules merged into every board. */
  getBaseCardColors(): string;
}

/**
 * One board, rendered where it is written: inside a ```tasks-kanban block in an
 * ordinary note.
 *
 * A {@link MarkdownRenderChild} so Obsidian's own lifecycle owns it — the board
 * is torn down when the note closes, the block is edited, or the leaf goes
 * away. The board's document is the block's body, and everything the board
 * persists (folds, settings, the query) is written back into that block and
 * nowhere else: the note is the whole board.
 */
export class BoardBlock extends MarkdownRenderChild {
  private readonly app: App;
  private readonly tasksIntegration: TasksIntegration;
  private readonly host: BoardBlockHost;
  private readonly ctx: MarkdownPostProcessorContext;
  /** The board as parsed from the block, kept so a write can rebuild the rest. */
  private board: BoardFile;
  private kanbanBoard: KanbanBoard | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    containerEl: HTMLElement,
    source: string,
    ctx: MarkdownPostProcessorContext,
    app: App,
    tasksIntegration: TasksIntegration,
    host: BoardBlockHost,
  ) {
    super(containerEl);
    this.app = app;
    this.tasksIntegration = tasksIntegration;
    this.host = host;
    this.ctx = ctx;
    this.board = parseBoardFile(source, this.noteName()).board;
  }

  onload(): void {
    this.containerEl.empty();
    this.containerEl.addClass("tasks-kanban-view");
    this.containerEl.addClass("tasks-kanban-block");

    const persistence: BoardStatePersistence = {
      getBaseQuery: () => this.host.getBaseQuery(),
      getBaseCardColors: () => this.host.getBaseCardColors(),
      get: () => this.readState(),
      save: (state) => void this.writeState(state),
    };

    this.kanbanBoard = new KanbanBoard(
      this.containerEl,
      this.app,
      this.tasksIntegration,
      persistence,
      () => void this.editSource(),
    );

    this.unsubscribe = this.tasksIntegration.subscribe((tasks: Task[]) => {
      this.kanbanBoard?.updateTasks(tasks);
    });

    this.kanbanBoard.render();
    this.kanbanBoard.updateTasks(this.tasksIntegration.getTasks());
  }

  onunload(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.kanbanBoard?.destroy();
    this.kanbanBoard = null;
  }

  /** The board's own slice, read out of the block as last parsed. */
  private readState(): BoardOwnState {
    return {
      query: this.board.query,
      boardType: this.board.boardType,
      collapsedColumns: this.board.collapsedColumns,
      collapsedGroups: this.board.collapsedGroups,
      columns: this.board.columns,
      metaColumns: this.board.metaColumns,
      actions: this.board.actions,
      columnTagPrefix: this.board.columnTagPrefix,
      columnOrder: this.board.columnOrder,
      dateField: this.board.dateField,
      dateColumns: this.board.dateColumns,
      noDateColumn: this.board.noDateColumn,
      cardColors: this.board.cardColors,
    };
  }

  /**
   * Write the board's slice back into its block, and only into its block: the
   * heading above it and whatever a user wrote below stay exactly as they are.
   *
   * Obsidian re-runs the processor once the file changes, so the board comes
   * back rebuilt from what was written — which is the check that the document
   * really is the state.
   */
  private async writeState(state: BoardOwnState): Promise<void> {
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

    const section = this.ctx.getSectionInfo(this.containerEl);
    const file = this.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
    if (!section || !(file instanceof TFile)) {
      // No section info (the block is not on screen in an editor) or no file to
      // write to: keep the change in memory rather than guessing at a range.
      return;
    }

    const body = serializeBoardFile(this.board);
    await this.app.vault.process(file, (text) =>
      replaceBoardBlockBody(text, section.lineStart, section.lineEnd, body),
    );
  }

  /**
   * Show the board's text: switch the note to source mode and put the cursor on
   * the first line of the block, the way Tasks lets you get back to a query.
   */
  private async editSource(): Promise<void> {
    const leaf = this.app.workspace
      .getLeavesOfType("markdown")
      .find(
        (candidate) =>
          candidate.view instanceof MarkdownView &&
          candidate.view.file?.path === this.ctx.sourcePath,
      );
    if (!leaf || !(leaf.view instanceof MarkdownView)) {
      return;
    }

    const section = this.ctx.getSectionInfo(this.containerEl);
    const state = leaf.getViewState();
    await leaf.setViewState({
      ...state,
      state: { ...state.state, mode: "source" },
    });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });

    if (section) {
      leaf.view.editor.setCursor({ line: section.lineStart + 1, ch: 0 });
    }
  }

  /** The note's base name, the board's display name when it states none. */
  private noteName(): string {
    const base = this.ctx.sourcePath.slice(
      this.ctx.sourcePath.lastIndexOf("/") + 1,
    );
    return base.replace(/\.md$/i, "") || emptyBoardFile("Board").name;
  }
}
