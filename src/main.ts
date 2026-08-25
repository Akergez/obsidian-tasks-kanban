import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";

import { BOARD_ICON, BoardIcons } from "./services/BoardIcons";
import { collectBoardDiagnostics } from "./services/BoardDiagnostics";
import { patchLeafViewMode } from "./services/leafViewMode";
import { BoardDiagnosticsModal } from "./components/BoardDiagnosticsModal";
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
   * The note each leaf was last seen holding.
   *
   * A leaf is swapped to the board view only when the file in it **changes**,
   * which is what separates "this note was just opened" from "the user chose to
   * look at this note's text". Without that separation, "Edit text" bounced
   * straight back to the board on the next event.
   */
  private readonly seenFiles = new Map<string, string>();
  /**
   * The last few decisions the swap above made, for the diagnostics command.
   * Kept in memory rather than logged: this happens on every file you open, and
   * a console line each time is noise until something goes wrong.
   */
  private readonly swapLog: string[] = [];
  /**
   * Notes the user asked to see as text ("Edit text"), so the interception
   * below leaves them in the editor until they ask for the board again.
   */
  private readonly textFiles = new Set<string>();

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
        editingText: (path) => this.textFiles.add(path),
      });
    });

    // Boards open as boards by changing the view type on the way in, before
    // the view is built. Reacting to `file-open` afterwards does not work:
    // Obsidian finishes its own open and the note lands in the editor anyway.
    this.register(
      patchLeafViewMode({
        proto: WorkspaceLeaf.prototype,
        markdownViewType: MARKDOWN_VIEW_TYPE,
        boardViewType: BOARD_VIEW_TYPE,
        shouldOpenAsBoard: (path) => this.boardNotes?.isBoard(path) === true,
        isTextPreferred: (path) => this.textFiles.has(path),
        onOpenedAsBoard: (path) =>
          this.recordSwap(`${path}: opened as a board`),
      }),
    );

    // Second chance for a note that carries a board block but declares nothing
    // in its frontmatter: the rule above cannot read files (it has to answer
    // synchronously), so the first open of such a note lands in the editor and
    // this swaps it, remembering the note so the next open goes straight in.
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
      id: "diagnose-boards",
      name: "Diagnose board detection",
      callback: () => {
        void this.diagnose();
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

  /** Remember one swap decision, keeping only the recent ones. */
  private recordSwap(line: string): void {
    this.swapLog.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
    if (this.swapLog.length > 20) {
      this.swapLog.shift();
    }
  }

  /**
   * Show what the plugin sees for the note in front of you.
   *
   * Whether a board opens as a board, and what the file explorer's row for it
   * looks like, only exist inside a running Obsidian — no test here can reach
   * them. This turns "it still does not work" into a list of facts.
   */
  private async diagnose(): Promise<void> {
    if (!this.boardNotes) {
      new Notice("Tasks Kanban: the plugin did not finish loading.");
      return;
    }
    const report = await collectBoardDiagnostics(
      this.app,
      this.boardNotes,
      this.manifest.version,
      BOARD_VIEW_TYPE,
    );
    const lines = [
      ...report.lines,
      "recent open decisions:",
      ...(this.swapLog.length === 0
        ? ["  (none — no note has been opened since the plugin loaded)"]
        : this.swapLog.map((entry) => `  ${entry}`)),
    ];
    new BoardDiagnosticsModal(this.app, lines.join("\n")).open();
  }

  /** Show the note in `leaf` as a board, keeping the same tab. */
  private async showAsBoard(leaf: WorkspaceLeaf): Promise<void> {
    const view = leaf.view;
    const path = view instanceof MarkdownView ? view.file?.path : undefined;
    const state = leaf.getViewState();
    await leaf.setViewState({ ...state, type: BOARD_VIEW_TYPE });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    if (path) {
      this.seenFiles.set(leafKey(leaf), path);
      this.textFiles.delete(path);

      // Shown as a board on purpose ⇒ the note says so from now on, in the
      // note itself, so it opens as one after a restart too.
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        await this.boardNotes?.declare(file);
      }
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

      const path = view.file.path;
      if (this.textFiles.has(path)) {
        continue;
      }

      const key = leafKey(leaf);
      if (this.seenFiles.get(key) === path) {
        // Same note as last time this leaf was looked at: whatever it is
        // showing, the user put it there. Leave it be.
        continue;
      }
      this.seenFiles.set(key, path);

      const isBoard = await this.boardNotes?.isBoardFile(view.file);
      this.recordSwap(`${path}: board=${isBoard}`);
      if (isBoard) {
        await this.showAsBoard(leaf);
        this.recordSwap(`${path}: swapped to the board view`);
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

    this.textFiles.delete(path);
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
    this.textFiles.add(path);
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
    this.seenFiles.set(leafKey(leaf), path);
  }
}
