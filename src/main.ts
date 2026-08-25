import { Plugin, TFile, type WorkspaceLeaf, Notice } from "obsidian";

import { TasksBoardView, BOARD_VIEW_TYPE } from "./views/TasksBoardView";
import { TasksIntegration, type StatusInfo } from "./services/TasksIntegration";
import { TasksKanbanSettingsTab } from "./settings/SettingsTab";
import { BoardPickerModal } from "./components/BoardPickerModal";
import {
  BoardRepository,
  boardPath,
  type BoardEntry,
} from "./services/BoardRepository";
import { BOARD_EXTENSION, emptyBoardFile } from "./query/boardFile";
import {
  DEFAULT_PLUGIN_DATA,
  resolveBoardType,
  resolveNoDateColumn,
  type BoardOwnState,
  type BoardStatePersistence,
  type LegacyBoardState,
  type PluginData,
} from "./types/persistence";
import { resolveDateField } from "./utils/dateColumns";
import { DEFAULT_DATE_FIELD } from "./utils/dateFilter";
import { resolveTaskFormatSetting } from "./utils/taskFormat";
import { buildWeeklyBoard, startOfWeek } from "./utils/weeklyBoard";
import {
  EMPTY_QUERY,
  serializeQuery,
  withSort,
  withTags,
} from "./query/boardQuery";

/**
 * The slice of {@link PluginData} the settings tab owns and commits as a unit.
 * Saved boards are no longer part of it — they are `.kanban` files, edited
 * through {@link BoardRepository}.
 */
export type SettingsSlice = Pick<
  PluginData,
  | "baseQuery"
  | "taskFormat"
  | "baseBoardType"
  | "baseColumns"
  | "baseColumnTagPrefix"
  | "baseColumnOrder"
  | "baseDateField"
  | "baseDateColumns"
  | "baseCardColors"
  | "boardsFolder"
  | "weeklyPlannerFolder"
>;

/**
 * Build a canonical query string from pre-query persisted fields
 * (`selectedTags`, `sortState`). Returns "" when there is nothing to migrate.
 */
function migrateLegacyQuery(data: LegacyBoardState | null): string {
  if (!data) {
    return "";
  }
  let query = withTags(EMPTY_QUERY, data.selectedTags ?? []);
  if (data.sortState) {
    query = withSort(query, data.sortState);
  }
  return serializeQuery(query);
}

export default class TasksKanbanPlugin extends Plugin {
  private tasksIntegration: TasksIntegration | null = null;
  private data: PluginData = DEFAULT_PLUGIN_DATA;
  private boards: BoardRepository | null = null;

  /** The base query and base board settings, for the settings tab. */
  getPluginData(): PluginData {
    return this.data;
  }

  /** The vault's configured Tasks statuses, for the settings column editor. */
  getStatuses(): StatusInfo[] {
    return this.tasksIntegration?.getStatuses() ?? [];
  }

  /** The board files in the vault, for the picker and the settings tab. */
  getBoardRepository(): BoardRepository {
    if (!this.boards) {
      this.boards = new BoardRepository(this.app, () => this.data.boardsFolder);
    }
    return this.boards;
  }

  /** The openable boards: the base board plus every board file. */
  getBoards(): { id: string; name: string }[] {
    return [
      { id: "", name: "Board (base)" },
      ...this.getBoardRepository()
        .list()
        .map((b: BoardEntry) => ({ id: b.path, name: b.name })),
    ];
  }

  /**
   * Persistence for the base board — the one view that is not backed by a file.
   * Board files are owned by their view (a TextFileView).
   */
  baseBoardPersistence(): BoardStatePersistence {
    return {
      getBaseQuery: () => this.data.baseQuery,
      // The base board's own colour rules ARE the shared ones, so there is
      // nothing to append: merging here would just duplicate every rule.
      getBaseCardColors: () => "",
      get: () => ({
        query: this.data.baseQuery,
        boardType: this.data.baseBoardType,
        collapsedColumns: this.data.baseCollapsedColumns,
        collapsedGroups: this.data.baseCollapsedGroups,
        columns: this.data.baseColumns,
        metaColumns: this.data.baseMetaColumns,
        actions: this.data.baseActions,
        columnTagPrefix: this.data.baseColumnTagPrefix,
        columnOrder: this.data.baseColumnOrder,
        dateField: this.data.baseDateField,
        dateColumns: this.data.baseDateColumns,
        noDateColumn: this.data.baseNoDateColumn,
        cardColors: this.data.baseCardColors,
      }),
      // The base board owns its whole slice now that a board's settings are
      // edited on the board itself; the settings pane only keeps what is
      // shared across every board.
      save: (state: BoardOwnState) => {
        this.data = {
          ...this.data,
          baseQuery: state.query,
          baseBoardType: state.boardType,
          baseCollapsedColumns: state.collapsedColumns,
          baseCollapsedGroups: state.collapsedGroups,
          baseColumns: state.columns,
          baseMetaColumns: state.metaColumns,
          baseActions: state.actions,
          baseColumnTagPrefix: state.columnTagPrefix,
          baseColumnOrder: state.columnOrder,
          baseDateField: state.dateField,
          baseDateColumns: state.dateColumns,
          baseNoDateColumn: state.noDateColumn,
          baseCardColors: state.cardColors,
        };
        return this.saveData(this.data);
      },
    };
  }

  /**
   * Persist the settings-owned slice of the plugin data, then refresh open
   * boards so a base-query or folder change takes effect immediately.
   */
  async saveSettings(settings: SettingsSlice) {
    this.data = { ...this.data, ...settings };
    await this.saveData(this.data);

    this.refreshOpenBoards();
  }

  /** Re-read every open board, after something outside the view changed it. */
  refreshOpenBoards(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(BOARD_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof TasksBoardView) {
        view.refresh();
      }
    }
  }

  /**
   * Open this week's planner, creating it the first time it is asked for.
   *
   * The board's name is its ISO week (`2026-W35`), which is also its file name,
   * so the same week always resolves to the same file: asking again later in
   * the week reopens the board you have been planning in, edits and all. A new
   * week simply has no file yet, so one is written.
   */
  async openWeeklyPlanner(): Promise<string> {
    const board = buildWeeklyBoard(startOfWeek(new Date()), DEFAULT_DATE_FIELD);
    const path = boardPath(this.data.weeklyPlannerFolder, board.name);
    const created = await this.getBoardRepository().ensure(path, board);
    if (created) {
      new Notice(`Tasks Kanban: created ${path}`);
    }
    await this.openBoard(path);
    return path;
  }

  /**
   * Create a fresh board file and open it. Returns the new file's path.
   */
  async createAndOpenBlankBoard(): Promise<string> {
    const path = await this.getBoardRepository().create("Untitled board");
    await this.openBoard(path);
    return path;
  }

  async onload() {
    const tasksPlugin = this.app.plugins.getPlugin("obsidian-tasks-plugin");
    if (!tasksPlugin) {
      new Notice(
        "Tasks kanban requires the tasks plugin. Install it from community plugins.",
      );
      return;
    }

    await this.loadPluginData();

    this.tasksIntegration = new TasksIntegration(
      this.app,
      () => this.data.taskFormat,
    );

    this.addSettingTab(new TasksKanbanSettingsTab(this.app, this));

    const tasksIntegration = this.tasksIntegration;
    this.registerView(BOARD_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      return new TasksBoardView(leaf, tasksIntegration, {
        getBaseQuery: () => this.data.baseQuery,
        getBaseCardColors: () => this.data.baseCardColors,
        baseBoardPersistence: () => this.baseBoardPersistence(),
      });
    });

    // Clicking a .kanban file in the file explorer opens the board view.
    this.registerExtensions([BOARD_EXTENSION], BOARD_VIEW_TYPE);

    // Board files written before this version lived inside data.json.
    await this.migrateSavedBoardsToFiles();

    this.addCommand({
      id: "open-board",
      name: "Open board",
      callback: () => {
        void this.openBaseBoard();
      },
    });

    this.addCommand({
      id: "open-saved-query",
      name: "Open board…",
      callback: () => {
        new BoardPickerModal(this.app, this.getBoards(), (id) => {
          void (id === "" ? this.openBaseBoard() : this.openBoard(id));
        }).open();
      },
    });

    this.addCommand({
      id: "open-blank-board",
      name: "Create new board",
      callback: () => {
        void this.createAndOpenBlankBoard();
      },
    });

    this.addCommand({
      id: "open-weekly-planner",
      name: "Open weekly planner",
      callback: () => {
        void this.openWeeklyPlanner();
      },
    });

    this.addRibbonIcon("calendar-days", "Open weekly planner", () => {
      void this.openWeeklyPlanner();
    });
  }

  onunload() {
    if (this.tasksIntegration) {
      this.tasksIntegration.unload();
      this.tasksIntegration = null;
    }
  }

  /**
   * Load persisted plugin data, merged over defaults so older installs and
   * partial data both yield a complete {@link PluginData}.
   *
   * Migration: data files written before multiple saved queries only carry a
   * single `query`/`collapsedColumns` (or, older still, `selectedTags`/
   * `sortState`). We fold those into the base query so existing boards keep
   * their filters and sort.
   */
  private async loadPluginData() {
    const data = (await this.loadData()) as
      (Partial<PluginData> & LegacyBoardState) | null;
    const baseColumnTagPrefix =
      data?.baseColumnTagPrefix ?? DEFAULT_PLUGIN_DATA.baseColumnTagPrefix;
    this.data = {
      baseQuery: data?.baseQuery ?? data?.query ?? migrateLegacyQuery(data),
      taskFormat: resolveTaskFormatSetting(data?.taskFormat),
      // Data files written before board types were explicit carry none, so the
      // base board keeps the kind its tag prefix used to imply.
      baseBoardType: resolveBoardType(data?.baseBoardType, baseColumnTagPrefix),
      baseDateField: resolveDateField(data?.baseDateField),
      baseDateColumns:
        data?.baseDateColumns ?? DEFAULT_PLUGIN_DATA.baseDateColumns,
      baseNoDateColumn: resolveNoDateColumn(data?.baseNoDateColumn),
      baseCollapsedColumns:
        data?.baseCollapsedColumns ??
        data?.collapsedColumns ??
        DEFAULT_PLUGIN_DATA.baseCollapsedColumns,
      baseCollapsedGroups:
        data?.baseCollapsedGroups ?? DEFAULT_PLUGIN_DATA.baseCollapsedGroups,
      baseColumns: data?.baseColumns ?? DEFAULT_PLUGIN_DATA.baseColumns,
      baseMetaColumns:
        data?.baseMetaColumns ?? DEFAULT_PLUGIN_DATA.baseMetaColumns,
      baseActions: data?.baseActions ?? DEFAULT_PLUGIN_DATA.baseActions,
      baseColumnTagPrefix,
      baseColumnOrder:
        data?.baseColumnOrder ?? DEFAULT_PLUGIN_DATA.baseColumnOrder,
      baseCardColors:
        data?.baseCardColors ?? DEFAULT_PLUGIN_DATA.baseCardColors,
      boardsFolder: data?.boardsFolder ?? DEFAULT_PLUGIN_DATA.boardsFolder,
      weeklyPlannerFolder:
        data?.weeklyPlannerFolder ?? DEFAULT_PLUGIN_DATA.weeklyPlannerFolder,
      // Read only so the one-time migration below can drain it.
      savedBoards:
        data?.savedBoards ??
        data?.savedQueries ??
        DEFAULT_PLUGIN_DATA.savedBoards,
    };
  }

  /**
   * One-time migration: boards used to live as entries in data.json. Write each
   * one out as a `.kanban` file, then clear the list so this never runs twice.
   * A board whose file already exists is skipped rather than overwritten.
   */
  private async migrateSavedBoardsToFiles(): Promise<void> {
    if (this.data.savedBoards.length === 0) {
      return;
    }

    const repository = this.getBoardRepository();
    for (const saved of this.data.savedBoards) {
      const columnTagPrefix = saved.columnTagPrefix ?? "";
      const board = {
        ...emptyBoardFile(saved.name || "Board"),
        query: saved.query ?? "",
        // These boards predate explicit types, so the old implicit rule decides.
        boardType: resolveBoardType(saved.boardType, columnTagPrefix),
        columns: saved.columns ?? [],
        columnTagPrefix,
        columnOrder: saved.columnOrder ?? "",
        cardColors: saved.cardColors ?? "",
        collapsedColumns: saved.collapsedColumns ?? [],
        collapsedGroups: saved.collapsedGroups ?? [],
      };
      const path = await repository.create(board.name);
      await repository.write(path, board);
    }

    const count = this.data.savedBoards.length;
    this.data = { ...this.data, savedBoards: [] };
    await this.saveData(this.data);
    new Notice(
      `Tasks Kanban: moved ${count} board${count === 1 ? "" : "s"} into ${
        this.data.boardsFolder || "the vault root"
      }.`,
    );
  }

  /** Open a board file, focusing it if it is already open. */
  async openBoard(path: string): Promise<void> {
    const existing = this.app.workspace
      .getLeavesOfType(BOARD_VIEW_TYPE)
      .find(
        (leaf) =>
          leaf.view instanceof TasksBoardView && leaf.view.file?.path === path,
      );
    if (existing) {
      this.app.workspace.setActiveLeaf(existing);
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Tasks Kanban: no board at ${path}`);
      return;
    }
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  /** Open the base board — the fileless view driven by the base query. */
  async openBaseBoard(): Promise<void> {
    const existing = this.app.workspace
      .getLeavesOfType(BOARD_VIEW_TYPE)
      .find((leaf) => leaf.view instanceof TasksBoardView && !leaf.view.file);
    if (existing) {
      this.app.workspace.setActiveLeaf(existing);
      return;
    }

    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: BOARD_VIEW_TYPE, active: true });
    this.app.workspace.setActiveLeaf(leaf);
  }
}
