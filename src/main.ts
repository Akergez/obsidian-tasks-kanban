import {
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  type WorkspaceLeaf,
} from "obsidian";

import { BOARD_ICON, BoardIcons } from "./services/BoardIcons";
import { BoardNotes } from "./services/BoardNotes";
import {
  BOARD_VIEW_TYPE,
  MARKDOWN_VIEW_TYPE,
  TasksBoardView,
} from "./views/TasksBoardView";
import { TasksIntegration, type StatusInfo } from "./services/TasksIntegration";
import { TasksKanbanSettingsTab } from "./settings/SettingsTab";
import { BoardPickerModal } from "./components/BoardPickerModal";
import {
  BoardRepository,
  boardPath,
  type BoardEntry,
} from "./services/BoardRepository";
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
 * A stable key for a leaf. Obsidian gives leaves an id internally; when it does
 * not, the object itself keys the map just as well for one session.
 */
const leafKeys = new WeakMap<object, string>();
let nextLeafKey = 0;
function leafKey(leaf: WorkspaceLeaf): string {
  const id = (leaf as unknown as { id?: string }).id;
  if (id) {
    return id;
  }
  let key = leafKeys.get(leaf);
  if (!key) {
    key = `leaf-${(nextLeafKey += 1)}`;
    leafKeys.set(leaf, key);
  }
  return key;
}

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
  /** Which notes are boards, for the icons in the explorer and on tabs. */
  private boardNotes: BoardNotes | null = null;
  /**
   * Leaves the user sent to the markdown editor with "Edit text", and the note
   * they did it to — so the swap above leaves them there.
   */
  private readonly textLeaves = new Map<string, string>();

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

    // Board notes carry the board icon in the file explorer and on their tabs.
    this.boardNotes = new BoardNotes(this.app);
    this.register(new BoardIcons(this.app, this.boardNotes).start());

    const tasksIntegration = this.tasksIntegration;
    this.registerView(BOARD_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      return new TasksBoardView(leaf, tasksIntegration, {
        getBaseQuery: () => this.data.baseQuery,
        getBaseCardColors: () => this.data.baseCardColors,
        editingText: (editedLeaf, path) =>
          this.textLeaves.set(leafKey(editedLeaf), path),
      });
    });

    // A board is a note, so Obsidian opens it in the markdown editor first; a
    // note that declares itself a board is handed straight to the board view,
    // which is what makes clicking one in the file explorer open the board.
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.swapBoardLeaves().catch((error) => {
          // A rejected promise here used to vanish, and with it the reason a
          // board opened as a page of YAML. Say so instead.
          console.error("Tasks Kanban: could not open a board note", error);
        });
      }),
    );

    this.addCommand({
      id: "open-as-board",
      name: "Open this note as a board",
      checkCallback: (checking) => {
        const leaf = this.app.workspace.getMostRecentLeaf();
        const isMarkdown = leaf?.view instanceof MarkdownView;
        if (!checking && leaf && isMarkdown) {
          void this.showAsBoard(leaf);
        }
        return Boolean(isMarkdown);
      },
    });

    // The same swap from the file explorer's own menu.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, _source, leaf) => {
        if (!(file instanceof TFile) || file.extension !== "md") {
          return;
        }
        menu.addItem((item) =>
          item
            .setTitle("Open as board")
            .setIcon(BOARD_ICON)
            .onClick(() => {
              void (leaf && leaf.view instanceof MarkdownView
                ? this.showAsBoard(leaf)
                : this.openBoard(file.path));
            }),
        );
      }),
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

  /** Show the note in `leaf` as a board, keeping the same tab. */
  private async showAsBoard(leaf: WorkspaceLeaf): Promise<void> {
    const view = leaf.view;
    const path = view instanceof MarkdownView ? view.file?.path : undefined;
    const state = leaf.getViewState();
    await leaf.setViewState({ ...state, type: BOARD_VIEW_TYPE });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    this.textLeaves.delete(leafKey(leaf));
    if (path) {
      // Shown as a board once ⇒ marked as one in the file explorer, even if the
      // note never declared itself.
      this.boardNotes?.remember(path);
    }
  }

  /**
   * Hand any note holding a board to the board view — this is what makes
   * clicking one in the file explorer open the board rather than its text.
   *
   * Every markdown leaf is checked, not just the active one: `file-open` says
   * nothing about which leaf it happened in, and guessing was the other half of
   * the planner opening as a page of YAML.
   *
   * A leaf the user sent to the editor with "Edit text" is left alone until it
   * shows something else, or the button would bounce straight back to the
   * board.
   */
  private async swapBoardLeaves(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(MARKDOWN_VIEW_TYPE)) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || !view.file) {
        continue;
      }

      const key = leafKey(leaf);
      if (this.textLeaves.get(key) === view.file.path) {
        continue;
      }
      this.textLeaves.delete(key);

      if (await this.boardNotes?.isBoardFile(view.file)) {
        await this.showAsBoard(leaf);
      }
    }
  }

  /**
   * Open a board note **as a board**, focusing it if it is already open.
   *
   * The view is set directly rather than by opening the file and waiting for
   * the swap below to notice: a note the plugin has just written is not in the
   * metadata cache yet, and a planner that opened as a page of YAML is exactly
   * what that race looks like.
   */
  async openBoard(path: string): Promise<void> {
    const existing = [
      ...this.app.workspace.getLeavesOfType(BOARD_VIEW_TYPE),
      ...this.app.workspace.getLeavesOfType(MARKDOWN_VIEW_TYPE),
    ].find((leaf) => {
      const view = leaf.view;
      const file =
        view instanceof TasksBoardView || view instanceof MarkdownView
          ? view.file
          : null;
      return file?.path === path;
    });

    if (existing) {
      if (existing.view instanceof MarkdownView) {
        await this.showAsBoard(existing);
        return;
      }
      this.app.workspace.setActiveLeaf(existing, { focus: true });
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Tasks Kanban: no board at ${path}`);
      return;
    }

    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: BOARD_VIEW_TYPE,
      active: true,
      state: { file: path },
    });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    this.boardNotes?.remember(path);
  }

  /** Open a board note as plain text, for editing it by hand. */
  async openBoardAsText(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Tasks Kanban: no note at ${path}`);
      return;
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
    this.textLeaves.set(leafKey(leaf), path);
  }
}
