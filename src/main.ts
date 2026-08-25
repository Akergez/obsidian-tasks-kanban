import { MarkdownView, Plugin, TFile, Notice } from "obsidian";

import { BoardBlock } from "./components/BoardBlock";
import { TasksIntegration, type StatusInfo } from "./services/TasksIntegration";
import { TasksKanbanSettingsTab } from "./settings/SettingsTab";
import { BoardPickerModal } from "./components/BoardPickerModal";
import {
  BoardRepository,
  boardPath,
  type BoardEntry,
} from "./services/BoardRepository";
import { BOARD_BLOCK_LANGUAGE } from "./query/markdownBoard";
import {
  DEFAULT_WEEKLY_TEMPLATE,
  renderWeeklyTemplate,
} from "./query/weeklyTemplate";
import {
  DEFAULT_PLUGIN_DATA,
  type LegacyBoardState,
  type PluginData,
} from "./types/persistence";
import { resolveTaskFormatSetting } from "./utils/taskFormat";
import { isoWeekName, startOfWeek } from "./utils/weeklyBoard";
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
  | "baseCardColors"
  | "boardsFolder"
  | "weeklyPlannerFolder"
  | "weeklyTemplatePath"
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

  /** The openable boards: every note in the boards folder. */
  getBoards(): { id: string; name: string }[] {
    return this.getBoardRepository()
      .list()
      .map((b: BoardEntry) => ({ id: b.path, name: b.name }));
  }

  /**
   * Persist the settings-owned slice of the plugin data, then re-render open
   * boards so a base-query or folder change takes effect immediately.
   */
  async saveSettings(settings: SettingsSlice) {
    this.data = { ...this.data, ...settings };
    await this.saveData(this.data);

    this.refreshOpenBoards();
  }

  /**
   * Re-render every board on screen, after a shared setting changed under it.
   *
   * Boards are code blocks now, so this asks Obsidian to re-run its markdown
   * post-processors rather than reaching into a view of our own.
   */
  refreshOpenBoards(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView) {
        leaf.view.previewMode?.rerender(true);
      }
    }
  }

  /**
   * The weekly template, creating it from the default the first time it is
   * asked for. Its path is a setting, so a vault can keep it anywhere; the
   * plugin's own copy lands in the vault root.
   */
  async weeklyTemplate(): Promise<string> {
    const path =
      this.data.weeklyTemplatePath.trim() ||
      DEFAULT_PLUGIN_DATA.weeklyTemplatePath;
    const repository = this.getBoardRepository();
    const created = await repository.ensureNote(path, DEFAULT_WEEKLY_TEMPLATE);
    if (created) {
      new Notice(`Tasks Kanban: created the weekly template at ${path}`);
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      // Unwritable path (a folder in the way, a read-only vault): fall back to
      // the built-in template rather than refusing to open the planner.
      new Notice(`Tasks Kanban: could not read the template at ${path}`);
      return DEFAULT_WEEKLY_TEMPLATE;
    }
    return this.app.vault.read(file);
  }

  /**
   * Open this week's planner, creating it the first time it is asked for.
   *
   * The note's name is the ISO week (`2026-W35`), so the same week always
   * resolves to the same file: asking again later in the week reopens the board
   * you have been planning in, edits and all. A new week simply has no note
   * yet, so the template is rendered for it and written.
   *
   * The name stays the plugin's to decide even though everything else about the
   * planner is the template's: it is what makes "this week's board" findable
   * without rendering and parsing the template first.
   */
  async openWeeklyPlanner(): Promise<string> {
    const monday = startOfWeek(new Date());
    const path = boardPath(this.data.weeklyPlannerFolder, isoWeekName(monday));

    const repository = this.getBoardRepository();
    if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFile)) {
      const { text, errors } = renderWeeklyTemplate(
        await this.weeklyTemplate(),
        monday,
      );
      for (const error of errors) {
        new Notice(`Tasks Kanban: ${error}`);
      }
      await repository.writeNote(path, text);
      new Notice(`Tasks Kanban: created ${path}`);
    }

    await this.openBoard(path);
    return path;
  }

  /** Open the weekly template itself, for editing. Creates it if absent. */
  async openWeeklyTemplate(): Promise<string> {
    await this.weeklyTemplate();
    const path =
      this.data.weeklyTemplatePath.trim() ||
      DEFAULT_PLUGIN_DATA.weeklyTemplatePath;
    await this.openBoard(path);
    return path;
  }

  /**
   * Create a fresh board note and open it. Returns the new file's path.
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
    // A board is a fenced block in a note, so Obsidian renders it wherever it
    // is written — including inside a daily note next to everything else.
    this.registerMarkdownCodeBlockProcessor(
      BOARD_BLOCK_LANGUAGE,
      (source, el, ctx) => {
        ctx.addChild(
          new BoardBlock(el, source, ctx, this.app, tasksIntegration, {
            getBaseQuery: () => this.data.baseQuery,
            getBaseCardColors: () => this.data.baseCardColors,
          }),
        );
      },
    );

    this.addCommand({
      id: "open-saved-query",
      name: "Open board…",
      callback: () => {
        new BoardPickerModal(this.app, this.getBoards(), (id) => {
          void this.openBoard(id);
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

    this.addCommand({
      id: "open-weekly-template",
      name: "Edit weekly planner template",
      callback: () => {
        void this.openWeeklyTemplate();
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
    this.data = {
      baseQuery: data?.baseQuery ?? data?.query ?? migrateLegacyQuery(data),
      taskFormat: resolveTaskFormatSetting(data?.taskFormat),
      baseCardColors:
        data?.baseCardColors ?? DEFAULT_PLUGIN_DATA.baseCardColors,
      boardsFolder: data?.boardsFolder ?? DEFAULT_PLUGIN_DATA.boardsFolder,
      weeklyPlannerFolder:
        data?.weeklyPlannerFolder ?? DEFAULT_PLUGIN_DATA.weeklyPlannerFolder,
      weeklyTemplatePath:
        data?.weeklyTemplatePath ?? DEFAULT_PLUGIN_DATA.weeklyTemplatePath,
    };
  }

  /** Open a board note, focusing it if it is already open. */
  async openBoard(path: string): Promise<void> {
    const existing = this.app.workspace
      .getLeavesOfType("markdown")
      .find(
        (leaf) =>
          leaf.view instanceof MarkdownView && leaf.view.file?.path === path,
      );
    if (existing) {
      this.app.workspace.setActiveLeaf(existing, { focus: true });
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Tasks Kanban: no board at ${path}`);
      return;
    }
    await this.app.workspace.getLeaf(true).openFile(file);
  }
}
