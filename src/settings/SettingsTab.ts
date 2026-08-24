import {
  App,
  type ButtonComponent,
  PluginSettingTab,
  Setting,
  type SettingDefinitionItem,
} from "obsidian";

import { parseQuery } from "../query/boardQuery";
import { parseColorRules } from "../utils/cardColors";
import { BOARD_EXTENSION } from "../query/boardFile";
import type { TaskFormatSetting } from "../utils/taskFormat";
import type TasksKanbanPlugin from "../main";

const DOCS_URL =
  "https://github.com/Djiit/obsidian-tasks-kanban/blob/main/docs/query-syntax.md";

// Literal query syntax shown as an example placeholder; intentionally verbatim.
const QUERY_PLACEHOLDER = [
  "tag includes #work",
  "description includes write tests",
  "sort by due reverse",
  "group by priority",
].join("\n");

// Literal rule syntax shown as an example placeholder; intentionally verbatim.
const CARD_COLORS_PLACEHOLDER = [
  "tag includes #urgent -> red",
  "status.type is IN_PROGRESS -> #3b82f6",
  "due before today -> orange",
].join("\n");

/** Dropdown labels for this plugin's task-format setting. */
const TASK_FORMAT_LABELS: Record<TaskFormatSetting, string> = {
  auto: "Follow the Tasks plugin",
  tasksPluginEmoji: "Emoji (📅 2026-08-24)",
  dataview: "Dataview ([due:: 2026-08-24])",
};

const TASK_FORMAT_DESC =
  "How dates are written back into your notes when you drag a card. Follow the " +
  "Tasks plugin reads its own Task Format setting; pick a format to pin it.";

const BASE_QUERY_DESC =
  "Applied on top of every board: each board's own query is merged with this " +
  "one. One instruction per line.";

const BASE_COLORS_DESC =
  "Applied to every board. A board's own rules are checked first and these " +
  "follow, so a board can override a shared colour but still inherits the rest. " +
  "One rule per line: a filter, then '->', then a CSS colour.";

const WEEKLY_FOLDER_DESC =
  "Vault folder the weekly planner's boards are created in. The ribbon's " +
  "calendar button opens this week's board there, creating it the first time.";

/**
 * Settings for the plugin as a whole.
 *
 * Only what is **shared across every board** lives here: the task format, the
 * base query and colour rules merged into each board, and where board files go.
 * A single board's own settings — its type, columns, query and colours — are
 * edited on the board itself (see BoardSettingsModal), because boards are files
 * and a vault accumulates them: a weekly planner alone adds one every week, so
 * a pane that listed every board would scroll without end.
 */
export class TasksKanbanSettingsTab extends PluginSettingTab {
  private plugin: TasksKanbanPlugin;

  // Working copies, committed on Save.
  private taskFormat: TaskFormatSetting = "auto";
  private baseQuery = "";
  private baseCardColors = "";
  private boardsFolder = "";
  private weeklyPlannerFolder = "";

  /** Parse errors keyed by field, so one bad field alone gates Save. */
  private errors = new Map<string, string[]>();
  private saveButton: ButtonComponent | null = null;

  constructor(app: App, plugin: TasksKanbanPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Obsidian 1.13 renders a settings tab declaratively from these definitions
   * and then **does not call {@link display}** unless the array is empty.
   *
   * Two fields here need validation that gates one shared Save, which the
   * declarative controls do not express, so we opt out on purpose. The cost is
   * that these settings do not show up in Obsidian's settings search; returning
   * anything here instead would silently hide the pane, which is exactly how
   * the per-board settings once went missing.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [];
  }

  display(): void {
    // Seed working copies from the plugin's current data each time the tab opens.
    const data = this.plugin.getPluginData();
    this.taskFormat = data.taskFormat;
    this.baseQuery = data.baseQuery;
    this.baseCardColors = data.baseCardColors;
    this.boardsFolder = data.boardsFolder;
    this.weeklyPlannerFolder = data.weeklyPlannerFolder;
    this.errors.clear();

    this.render();
  }

  private render(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.saveButton = null;

    new Setting(containerEl).setName("Tasks integration").setHeading();

    new Setting(containerEl)
      .setName("Task format")
      .setDesc(TASK_FORMAT_DESC)
      .addDropdown((dropdown) => {
        dropdown
          .addOptions(TASK_FORMAT_LABELS)
          .setValue(this.taskFormat)
          .onChange((value) => {
            this.taskFormat = value as TaskFormatSetting;
          });
      });

    new Setting(containerEl).setName("Shared across every board").setHeading();

    containerEl.createEl("p", {
      cls: "tasks-kanban-settings-help",
      text: "A single board's own settings — type, columns, query and colours — are edited on the board, with the gear button above it.",
    });

    this.renderQueryField(containerEl);
    this.renderCardColorsField(containerEl);

    new Setting(containerEl).setName("Boards").setHeading();

    containerEl.createEl("p", {
      cls: "tasks-kanban-settings-help",
      text: `Each board is a .${BOARD_EXTENSION} file in your vault — open one by clicking it in the file explorer.`,
    });

    new Setting(containerEl)
      .setName("Boards folder")
      .setDesc(
        "Vault folder new boards are created in and existing ones are listed from. Empty: the vault root.",
      )
      .addText((text) => {
        text
          .setPlaceholder("Kanban")
          .setValue(this.boardsFolder)
          .onChange((value) => {
            this.boardsFolder = value.trim();
          });
      });

    new Setting(containerEl)
      .setName("Weekly planner folder")
      .setDesc(WEEKLY_FOLDER_DESC)
      .addText((text) => {
        text
          .setPlaceholder("Kanban/Weekly")
          .setValue(this.weeklyPlannerFolder)
          .onChange((value) => {
            this.weeklyPlannerFolder = value.trim();
          });
      });

    const saveSetting = new Setting(containerEl).addButton((button) => {
      this.saveButton = button;
      button
        .setButtonText("Save")
        .setCta()
        .setDisabled(this.hasErrors())
        .onClick(() => {
          void this.save();
        });
    });
    saveSetting.settingEl.addClass("tasks-kanban-settings-save");
  }

  /**
   * The shared query, validated on every change. Errors render into a sibling
   * div and toggle the Save button — without re-rendering the pane, which would
   * blur the textarea the user is typing in.
   */
  private renderQueryField(containerEl: HTMLElement): void {
    const setting = new Setting(containerEl)
      .setName("Base query")
      .setClass("tasks-kanban-setting-query")
      .setDesc(BASE_QUERY_DESC)
      .addTextArea((textArea) => {
        textArea.inputEl.rows = 6;
        textArea.inputEl.spellcheck = false;
        textArea.inputEl.placeholder = QUERY_PLACEHOLDER;
        textArea.setValue(this.baseQuery);
        textArea.onChange((value) => {
          this.baseQuery = value;
          this.validate("query", parseQuery(value).errors, errorEl);
        });
      });

    setting.descEl.createEl("br");
    setting.descEl.createEl("a", {
      text: "See the documentation.",
      href: DOCS_URL,
    });

    const errorEl = containerEl.createDiv({
      cls: "tasks-kanban-settings-errors",
    });
    this.validate("query", parseQuery(this.baseQuery).errors, errorEl);
  }

  /** The shared colour rules, validated the same way as the query. */
  private renderCardColorsField(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Base card colours")
      .setClass("tasks-kanban-setting-query")
      .setDesc(BASE_COLORS_DESC)
      .addTextArea((textArea) => {
        textArea.inputEl.rows = 4;
        textArea.inputEl.spellcheck = false;
        textArea.inputEl.placeholder = CARD_COLORS_PLACEHOLDER;
        textArea.setValue(this.baseCardColors);
        textArea.onChange((value) => {
          this.baseCardColors = value;
          this.validate("colors", parseColorRules(value).errors, errorEl);
        });
      });

    const errorEl = containerEl.createDiv({
      cls: "tasks-kanban-settings-errors",
    });
    this.validate(
      "colors",
      parseColorRules(this.baseCardColors).errors,
      errorEl,
    );
  }

  /** Record a field's errors, render them, and keep Save in sync. */
  private validate(key: string, errors: string[], errorEl: HTMLElement): void {
    if (errors.length === 0) {
      this.errors.delete(key);
    } else {
      this.errors.set(key, errors);
    }

    errorEl.empty();
    for (const error of errors) {
      errorEl.createDiv({ cls: "tasks-kanban-settings-error", text: error });
    }

    this.saveButton?.setDisabled(this.hasErrors());
  }

  private hasErrors(): boolean {
    return this.errors.size > 0;
  }

  private async save(): Promise<void> {
    if (this.hasErrors()) {
      return;
    }

    const data = this.plugin.getPluginData();
    await this.plugin.saveSettings({
      // The base board's own column slice is edited on the board itself, so it
      // is carried through untouched rather than read off this pane.
      baseBoardType: data.baseBoardType,
      baseColumns: data.baseColumns,
      baseColumnTagPrefix: data.baseColumnTagPrefix,
      baseColumnOrder: data.baseColumnOrder,
      baseDateField: data.baseDateField,
      baseDateColumns: data.baseDateColumns,

      taskFormat: this.taskFormat,
      baseQuery: this.baseQuery,
      baseCardColors: this.baseCardColors,
      boardsFolder: this.boardsFolder,
      weeklyPlannerFolder: this.weeklyPlannerFolder,
    });
  }
}
