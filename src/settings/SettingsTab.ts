import {
  App,
  type ButtonComponent,
  PluginSettingTab,
  Setting,
  type SettingDefinitionItem,
} from "obsidian";

import { parseQuery } from "../query/boardQuery";
import { parseColorRules } from "../utils/cardColors";
import type {
  BoardType,
  ColumnConfig,
  DateColumnConfig,
} from "../types/persistence";
import { BOARD_EXTENSION, type BoardFile } from "../query/boardFile";
import type { BoardEntry } from "../services/BoardRepository";
import type { StatusInfo } from "../services/TasksIntegration";
import {
  DATE_FIELDS,
  DATE_FIELD_LABELS,
  isValidColumnDate,
  todayISO,
} from "../utils/dateColumns";
import type { DateField } from "../utils/dateFilter";
import type { TaskFormatSetting } from "../utils/taskFormat";
import type TasksKanbanPlugin from "../main";
import type { SettingsSlice } from "../main";

const DOCS_URL =
  "https://github.com/Djiit/obsidian-tasks-kanban/blob/main/docs/query-syntax.md";

// Literal query syntax shown as an example placeholder; intentionally verbatim.
const QUERY_PLACEHOLDER = [
  "tag includes #work",
  "description includes write tests",
  "sort by due reverse",
  "group by priority",
].join("\n");

/**
 * The part of a board that decides its columns. A {@link BoardFile} already has
 * this shape, and the base board keeps a working copy of it, so one set of
 * controls edits either.
 */
type ColumnSlice = Pick<
  BoardFile,
  | "boardType"
  | "columnTagPrefix"
  | "columnOrder"
  | "dateField"
  | "dateColumns"
  | "columns"
>;

/** Dropdown labels for the three board types. */
const BOARD_TYPE_LABELS: Record<BoardType, string> = {
  status: "Status columns",
  tag: "Tag columns",
  date: "Date columns",
};

/** Shared description of the board-type control (pane + settings search). */
const BOARD_TYPE_DESC =
  "What the columns of this board are. Status: one column per status type, or " +
  "your own partition over status symbols. Tag: one column per #<prefix>_<column> " +
  "tag on your tasks. Date: one column per day you name, on one date field.";

/** Dropdown labels for this plugin's task-format setting. */
const TASK_FORMAT_LABELS: Record<TaskFormatSetting, string> = {
  auto: "Follow the Tasks plugin",
  tasksPluginEmoji: "Emoji (📅 2026-08-24)",
  dataview: "Dataview ([due:: 2026-08-24])",
};

/** Shared description of the task-format control (pane + settings search). */
const TASK_FORMAT_DESC =
  "How dates are written back into your notes when you drag a card. Follow the " +
  "Tasks plugin reads its own Task Format setting; pick a format to pin it.";

/** Shared description of the column-tag-prefix control (pane + settings search). */
const TAG_PREFIX_DESC =
  "Shared prefix of this board's column tags (e.g. 'sprint'): one column per " +
  "#sprint_<column> tag found, ordered alphabetically, plus a 'No column' column. " +
  "Dragging a card rewrites the tag.";

/** Shared description of the column-order control (pane + settings search). */
const COLUMN_ORDER_DESC =
  "Comma-separated column names (the part after the prefix), leftmost first — " +
  "e.g. 'todo, doing, done'. Columns not listed follow alphabetically. A listed " +
  "column shows up even when no task carries its tag yet. Empty: all alphabetical.";

/** Shared description of the date-field control (pane + settings search). */
const DATE_FIELD_DESC =
  "The task date this board's columns are days of. Dragging a card writes that " +
  "day into this field.";

/** Shared description of the date-columns editor. */
const DATE_COLUMNS_DESC =
  "One column per exact day. A task lands in the column matching its date; a task " +
  "whose date matches no column is hidden. Tasks with no date go to 'No date', and " +
  "dropping a card there clears the field.";

/** Shared description of the weekly-planner folder (pane + settings search). */
const WEEKLY_FOLDER_DESC =
  "Vault folder the weekly planner's boards are created in. The ribbon's " +
  "calendar button opens this week's board there, creating it the first time. " +
  "Keeping it inside the boards folder also lists those boards below.";

/** Shared description of the card-colour control (pane + settings search). */
const CARD_COLORS_DESC =
  "One rule per line: a filter, then '->', then a CSS colour. The first matching " +
  "rule paints that card's left edge, so put the most specific rule on top. " +
  "Filters use the same syntax as the query above.";

// Literal rule syntax shown as an example placeholder; intentionally verbatim.
const CARD_COLORS_PLACEHOLDER = [
  "tag includes #urgent -> red",
  "status.type is IN_PROGRESS -> #3b82f6",
  "due before today -> orange",
].join("\n");

/** A unique id generator for new columns. */
function newColumnId(): string {
  return crypto.randomUUID();
}

/**
 * Settings tab for the Tasks Kanban plugin.
 *
 * Edits the shared base board plus every `.kanban` board file in the vault.
 * All edits are kept in working copies and committed together via Save, which
 * writes the base slice to data.json and each board back to its own file; the
 * Save button is disabled while any query, colour rule or column date is
 * invalid.
 */
export class TasksKanbanSettingsTab extends PluginSettingTab {
  private plugin: TasksKanbanPlugin;

  // Working copies, committed on Save.
  private taskFormat: TaskFormatSetting = "auto";
  private baseQuery = "";
  private baseCardColors = "";
  /** The base board's column slice, edited by the same controls as a file's. */
  private baseSlice: ColumnSlice = emptySlice();
  /** Board files loaded from disk, edited in place and written back on Save. */
  private boards: { path: string; board: BoardFile }[] = [];
  private boardsFolder = "";
  private weeklyPlannerFolder = "";
  /** Paths deleted in the pane, removed from disk on Save. */
  private deletedBoards: string[] = [];

  // Parse-error state, keyed by field ("base" or a saved-board id).
  private errors = new Map<string, string[]>();
  private saveButton: ButtonComponent | null = null;

  constructor(app: App, plugin: TasksKanbanPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const data = this.plugin.getPluginData();

    return [
      {
        type: "group",
        heading: "Tasks integration",
        items: [
          {
            name: "Task format",
            desc: TASK_FORMAT_DESC,
            control: {
              type: "dropdown",
              key: "taskFormat",
              options: TASK_FORMAT_LABELS,
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Base board",
        items: [
          {
            name: "Board type",
            desc: BOARD_TYPE_DESC,
            control: {
              type: "dropdown",
              key: "baseBoardType",
              options: BOARD_TYPE_LABELS,
            },
          },
          {
            name: "Base query",
            desc: "The query is applied on top of every board; saved boards are merged with it. One instruction per line.",
            aliases: data.baseQuery.split("\n").filter((l) => l.trim()),
            control: {
              type: "textarea",
              key: "baseQuery",
              placeholder: QUERY_PLACEHOLDER,
            },
          },
          {
            name: "Column tag prefix",
            desc: TAG_PREFIX_DESC,
            control: {
              type: "text",
              key: "baseColumnTagPrefix",
              placeholder: "sprint",
            },
          },
          {
            name: "Column order",
            desc: COLUMN_ORDER_DESC,
            control: {
              type: "text",
              key: "baseColumnOrder",
              placeholder: "todo, doing, done",
            },
          },
          {
            name: "Date field",
            desc: DATE_FIELD_DESC,
            control: {
              type: "dropdown",
              key: "baseDateField",
              options: dateFieldOptions(),
            },
          },
          {
            name: "Card colours",
            desc: CARD_COLORS_DESC,
            control: {
              type: "textarea",
              key: "baseCardColors",
              placeholder: CARD_COLORS_PLACEHOLDER,
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Boards",
        items: [
          {
            name: "Boards folder",
            desc: `Vault folder holding the .${BOARD_EXTENSION} board files. Empty: the vault root.`,
            control: {
              type: "text",
              key: "boardsFolder",
              placeholder: "Kanban",
            },
          },
          {
            name: "Weekly planner folder",
            desc: WEEKLY_FOLDER_DESC,
            control: {
              type: "text",
              key: "weeklyPlannerFolder",
              placeholder: "Kanban/Weekly",
            },
          },
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    const data = this.plugin.getPluginData();
    if (key === "taskFormat") {
      return data.taskFormat;
    }
    if (key === "baseQuery") {
      return data.baseQuery;
    }
    if (key === "baseBoardType") {
      return data.baseBoardType;
    }
    if (key === "baseColumnsEnabled") {
      return data.baseColumns.length > 0;
    }
    if (key === "baseColumnTagPrefix") {
      return data.baseColumnTagPrefix;
    }
    if (key === "baseColumnOrder") {
      return data.baseColumnOrder;
    }
    if (key === "baseDateField") {
      return data.baseDateField;
    }
    if (key === "baseCardColors") {
      return data.baseCardColors;
    }
    if (key === "boardsFolder") {
      return data.boardsFolder;
    }
    if (key === "weeklyPlannerFolder") {
      return data.weeklyPlannerFolder;
    }
    return undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const data = this.plugin.getPluginData();
    // Every control commits the whole settings slice; `patch` is the one field
    // it changes, laid over the currently persisted values.
    const commit = (patch: Partial<SettingsSlice>) =>
      this.plugin.saveSettings({
        baseQuery: data.baseQuery,
        taskFormat: data.taskFormat,
        baseBoardType: data.baseBoardType,
        baseColumns: data.baseColumns,
        baseColumnTagPrefix: data.baseColumnTagPrefix,
        baseColumnOrder: data.baseColumnOrder,
        baseDateField: data.baseDateField,
        baseDateColumns: data.baseDateColumns,
        baseCardColors: data.baseCardColors,
        boardsFolder: data.boardsFolder,
        weeklyPlannerFolder: data.weeklyPlannerFolder,
        ...patch,
      });
    if (key === "taskFormat") {
      await commit({ taskFormat: value as TaskFormatSetting });
      return;
    }
    if (key === "baseQuery") {
      await commit({ baseQuery: value as string });
      return;
    }
    if (key === "baseBoardType") {
      await commit({ baseBoardType: value as BoardType });
      return;
    }
    if (key === "baseColumnsEnabled") {
      await commit({
        baseColumns: value
          ? [{ id: newColumnId(), title: "", symbols: [] }]
          : [],
      });
      return;
    }
    if (key === "baseColumnTagPrefix") {
      await commit({ baseColumnTagPrefix: value as string });
      return;
    }
    if (key === "baseColumnOrder") {
      await commit({ baseColumnOrder: value as string });
      return;
    }
    if (key === "baseDateField") {
      await commit({ baseDateField: value as DateField });
      return;
    }
    if (key === "baseCardColors") {
      await commit({ baseCardColors: value as string });
      return;
    }
    if (key === "boardsFolder") {
      await commit({ boardsFolder: (value as string).trim() });
      return;
    }
    if (key === "weeklyPlannerFolder") {
      await commit({ weeklyPlannerFolder: (value as string).trim() });
      return;
    }
  }

  display(): void {
    // Seed working copies from the plugin's current data each time the tab opens.
    const data = this.plugin.getPluginData();
    this.taskFormat = data.taskFormat;
    this.baseQuery = data.baseQuery;
    this.baseCardColors = data.baseCardColors;
    this.baseSlice = {
      boardType: data.baseBoardType,
      columnTagPrefix: data.baseColumnTagPrefix,
      columnOrder: data.baseColumnOrder,
      dateField: data.baseDateField,
      dateColumns: data.baseDateColumns.map((c) => ({ ...c })),
      columns: data.baseColumns.map((c) => ({ ...c, symbols: [...c.symbols] })),
    };
    this.boardsFolder = data.boardsFolder;
    this.weeklyPlannerFolder = data.weeklyPlannerFolder;
    this.boards = [];
    this.deletedBoards = [];
    this.errors.clear();

    this.render();
    // Board files are read from the vault, so the boards section fills in a
    // moment later; the base-board section above is usable immediately.
    void this.loadBoards();
  }

  /** Read every board file into a working copy, then redraw the pane. */
  private async loadBoards(): Promise<void> {
    const repository = this.plugin.getBoardRepository();
    const entries: BoardEntry[] = repository.list();
    const loaded: { path: string; board: BoardFile }[] = [];

    for (const entry of entries) {
      const result = await repository.read(entry.path);
      if (result) {
        loaded.push({ path: entry.path, board: result.board });
      }
    }

    this.boards = loaded;
    this.render();
  }

  /** (Re)build the whole settings pane from the working copies. */
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

    new Setting(containerEl).setName("Base board").setHeading();

    containerEl.createEl("p", {
      cls: "tasks-kanban-settings-help",
      text: "The query is applied on top of every board; saved boards are merged with it. The board type and columns apply to the default board.",
    });

    this.renderQueryField(containerEl, "base", this.baseQuery, (value) => {
      this.baseQuery = value;
    });
    this.renderColumnsSection(containerEl, "base", this.baseSlice);
    this.renderCardColorsField(
      containerEl,
      "base-colors",
      this.baseCardColors,
      (value) => {
        this.baseCardColors = value;
      },
    );

    new Setting(containerEl).setName("Boards").setHeading();

    containerEl.createEl("p", {
      cls: "tasks-kanban-settings-help",
      text: `Each board is a .${BOARD_EXTENSION} file in your vault — open one by clicking it in the file explorer. Edits here are written back to the file on Save.`,
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

    for (const entry of this.boards) {
      this.renderBoardFile(containerEl, entry);
    }

    new Setting(containerEl).addButton((button) => {
      button.setButtonText("Add board").onClick(() => {
        void this.addBoard();
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
   * Render one board file: its name, query, columns and colour rules, plus a
   * delete button. Edits land in the working copy; Save writes the file.
   */
  private renderBoardFile(
    containerEl: HTMLElement,
    entry: { path: string; board: BoardFile },
  ): void {
    const { board, path } = entry;

    new Setting(containerEl)
      .setName("Name")
      .setDesc(path)
      .addText((text) => {
        text.setValue(board.name).onChange((value) => {
          board.name = value;
        });
      })
      .addExtraButton((button) => {
        button
          .setIcon("trash")
          .setTooltip("Delete this board file")
          .onClick(() => {
            this.deletedBoards.push(path);
            this.boards = this.boards.filter((b) => b.path !== path);
            this.errors.delete(path);
            this.errors.delete(`${path}-colors`);
            this.errors.delete(`${path}-dates`);
            this.render();
          });
      });

    this.renderQueryField(containerEl, path, board.query, (value) => {
      board.query = value;
    });
    this.renderColumnsSection(containerEl, path, board);
    this.renderCardColorsField(
      containerEl,
      `${path}-colors`,
      board.cardColors,
      (value) => {
        board.cardColors = value;
      },
    );
  }

  /** Create a new board file on disk, then reload the pane's list. */
  private async addBoard(): Promise<void> {
    await this.plugin.saveSettings({
      ...this.plugin.getPluginData(),
      boardsFolder: this.boardsFolder,
    });
    await this.plugin.getBoardRepository().create("New board");
    await this.loadBoards();
  }

  /**
   * Render one board's column configuration: the board-type picker, then only
   * the fields that type uses.
   *
   * The type is an explicit choice, not a side effect of filling in a field —
   * so the other types' settings are kept in the working copy while hidden, and
   * switching back restores them. `key` scopes this board's error entries.
   */
  private renderColumnsSection(
    containerEl: HTMLElement,
    key: string,
    slice: ColumnSlice,
  ): void {
    new Setting(containerEl)
      .setName("Board type")
      .setDesc(BOARD_TYPE_DESC)
      .addDropdown((dropdown) => {
        dropdown
          .addOptions(BOARD_TYPE_LABELS)
          .setValue(slice.boardType)
          .onChange((value) => {
            slice.boardType = value as BoardType;
            seedForType(slice);
            // A different type means a different set of fields below.
            this.render();
          });
      });

    if (slice.boardType === "tag") {
      this.renderTagColumnFields(containerEl, slice);
      return;
    }
    if (slice.boardType === "date") {
      this.renderDateColumnFields(containerEl, key, slice);
      return;
    }
    this.renderStatusColumnFields(containerEl, slice);
  }

  /** Tag boards: the shared tag prefix and the column order. */
  private renderTagColumnFields(
    containerEl: HTMLElement,
    slice: ColumnSlice,
  ): void {
    new Setting(containerEl)
      .setName("Column tag prefix")
      .setDesc(TAG_PREFIX_DESC)
      .addText((text) => {
        text
          .setPlaceholder("sprint")
          .setValue(slice.columnTagPrefix)
          .onChange((value) => {
            slice.columnTagPrefix = normalizeTagPrefix(value);
          });
      });

    new Setting(containerEl)
      .setName("Column order")
      .setDesc(COLUMN_ORDER_DESC)
      .addText((text) => {
        text
          .setPlaceholder("todo, doing, done")
          .setValue(slice.columnOrder)
          .onChange((value) => {
            slice.columnOrder = value;
          });
      });
  }

  /** Date boards: the date field, then one row per configured day. */
  private renderDateColumnFields(
    containerEl: HTMLElement,
    key: string,
    slice: ColumnSlice,
  ): void {
    new Setting(containerEl)
      .setName("Date field")
      .setDesc(DATE_FIELD_DESC)
      .addDropdown((dropdown) => {
        dropdown
          .addOptions(dateFieldOptions())
          .setValue(slice.dateField)
          .onChange((value) => {
            slice.dateField = value as DateField;
          });
      });

    const errorKey = `${key}-dates`;
    new Setting(containerEl)
      .setName("Date columns")
      .setDesc(DATE_COLUMNS_DESC)
      .addButton((button) => {
        button.setButtonText("Add column").onClick(() => {
          slice.dateColumns = [
            ...slice.dateColumns,
            { id: newColumnId(), title: "", date: todayISO() },
          ];
          this.render();
        });
      });

    const errorEl = containerEl.createDiv({
      cls: "tasks-kanban-settings-errors",
    });

    for (const column of slice.dateColumns) {
      new Setting(containerEl)
        .setClass("tasks-kanban-setting-column")
        .addText((text) => {
          text
            .setPlaceholder("Column name (optional)")
            .setValue(column.title)
            .onChange((value) => {
              column.title = value;
            });
        })
        .addText((text) => {
          text.inputEl.type = "date";
          text.setValue(column.date).onChange((value) => {
            column.date = value;
            this.validateDateColumns(errorKey, slice.dateColumns, errorEl);
          });
        })
        .addExtraButton((button) => {
          button
            .setIcon("trash")
            .setTooltip("Delete column")
            .onClick(() => {
              slice.dateColumns = slice.dateColumns.filter(
                (c) => c.id !== column.id,
              );
              this.render();
            });
        });
    }

    this.validateDateColumns(errorKey, slice.dateColumns, errorEl);
  }

  /** Reject unusable days, surface why, and keep Save in sync. */
  private validateDateColumns(
    key: string,
    columns: DateColumnConfig[],
    errorEl: HTMLElement,
  ): void {
    const errors: string[] = [];
    const seen = new Set<string>();
    columns.forEach((column, index) => {
      const label = column.title.trim() || `Column ${index + 1}`;
      const date = column.date.trim();
      if (date === "") {
        errors.push(`${label}: pick a day for this column.`);
        return;
      }
      if (!isValidColumnDate(date)) {
        errors.push(`${label}: "${date}" is not a date (use YYYY-MM-DD).`);
        return;
      }
      if (seen.has(date)) {
        errors.push(`${label}: ${date} is already used by another column.`);
        return;
      }
      seen.add(date);
    });

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

  /**
   * Status boards: default status columns, or a custom set.
   *
   * A toggle switches between default status columns (`columns` empty) and a
   * custom set. When custom, each column has a name, a status-symbol multi-select
   * (the first checked symbol is the drop target), and a delete button, plus an
   * "Add column" button. Structural edits (toggle/add/delete) re-render the pane.
   */
  private renderStatusColumnFields(
    containerEl: HTMLElement,
    slice: ColumnSlice,
  ): void {
    const custom = slice.columns.length > 0;

    new Setting(containerEl)
      .setName("Custom columns")
      .setDesc(
        "Off: one column per status type. On: define columns as status-symbol partitions.",
      )
      .addToggle((toggle) => {
        toggle.setValue(custom).onChange((value) => {
          // Turning on seeds one empty column; turning off clears the set.
          slice.columns = value
            ? [{ id: newColumnId(), title: "", symbols: [] }]
            : [];
          this.render();
        });
      });

    if (!custom) {
      return;
    }

    const statuses = this.plugin.getStatuses();
    for (const column of slice.columns) {
      this.renderColumnRow(containerEl, column, slice, statuses);
    }

    new Setting(containerEl).addButton((button) => {
      button.setButtonText("Add column").onClick(() => {
        slice.columns = [
          ...slice.columns,
          { id: newColumnId(), title: "", symbols: [] },
        ];
        this.render();
      });
    });
  }

  /** Render one custom-column row: name, status checkboxes, delete. */
  private renderColumnRow(
    containerEl: HTMLElement,
    column: ColumnConfig,
    slice: ColumnSlice,
    statuses: StatusInfo[],
  ): void {
    const setting = new Setting(containerEl)
      .setClass("tasks-kanban-setting-column")
      .addText((text) => {
        text
          .setPlaceholder("Column name")
          .setValue(column.title)
          .onChange((value) => {
            column.title = value;
          });
      })
      .addExtraButton((button) => {
        button
          .setIcon("trash")
          .setTooltip("Delete column")
          .onClick(() => {
            slice.columns = slice.columns.filter((c) => c.id !== column.id);
            this.render();
          });
      });

    // Status-symbol checkbox list. The first checked symbol (in status order) is
    // the drop target; we keep `symbols` ordered to match the status list so the
    // drop symbol is predictable.
    const list = setting.controlEl.createDiv({
      cls: "tasks-kanban-column-symbols",
    });
    for (const status of statuses) {
      const label = list.createEl("label", {
        cls: "tasks-kanban-column-symbol",
      });
      const checkbox = label.createEl("input", { type: "checkbox" });
      checkbox.checked = column.symbols.includes(status.symbol);
      checkbox.addEventListener("change", () => {
        const checkedSymbols = statuses
          .map((s) => s.symbol)
          .filter((symbol) =>
            symbol === status.symbol
              ? checkbox.checked
              : column.symbols.includes(symbol),
          );
        column.symbols = checkedSymbols;
        this.refreshColumnHint(setting.controlEl, column, statuses);
      });
      label.createSpan({
        cls: "tasks-kanban-column-symbol-text",
        text: `${describeSymbol(status.symbol)} ${status.name}`,
      });
    }

    const hint = setting.controlEl.createDiv({
      cls: "tasks-kanban-column-hint",
    });
    this.renderColumnHint(hint, column, statuses);
  }

  /** Re-render the drop-symbol hint for a column after a checkbox toggles. */
  private refreshColumnHint(
    controlEl: HTMLElement,
    column: ColumnConfig,
    statuses: StatusInfo[],
  ): void {
    const hint = controlEl.querySelector<HTMLElement>(
      ".tasks-kanban-column-hint",
    );
    if (hint) {
      this.renderColumnHint(hint, column, statuses);
    }
  }

  /** Show which symbol a drop writes (the first selected), or a prompt if none. */
  private renderColumnHint(
    hint: HTMLElement,
    column: ColumnConfig,
    statuses: StatusInfo[],
  ): void {
    hint.empty();
    if (column.symbols.length === 0) {
      hint.setText("Select at least one status.");
      return;
    }
    const drop = column.symbols[0];
    const name = statuses.find((s) => s.symbol === drop)?.name ?? drop;
    hint.setText(`Dropped cards become: ${describeSymbol(drop)} ${name}`);
  }

  /**
   * Render the card-spine colour rules for one board: a textarea of
   * `<filter> -> <colour>` lines, validated on every change like the query
   * field. Errors render into a sibling div and gate the Save button, without
   * re-rendering the pane (which would blur the textarea mid-typing).
   */
  private renderCardColorsField(
    containerEl: HTMLElement,
    key: string,
    initialValue: string,
    onChange: (value: string) => void,
  ): void {
    new Setting(containerEl)
      .setName("Card colours")
      .setClass("tasks-kanban-setting-query")
      .setDesc(CARD_COLORS_DESC)
      .addTextArea((textArea) => {
        textArea.inputEl.rows = 4;
        textArea.inputEl.spellcheck = false;
        textArea.inputEl.placeholder = CARD_COLORS_PLACEHOLDER;
        textArea.setValue(initialValue);
        textArea.onChange((value) => {
          onChange(value);
          this.validateColorRules(key, value, errorEl);
        });
      });

    const errorEl = containerEl.createDiv({
      cls: "tasks-kanban-settings-errors",
    });

    this.validateColorRules(key, initialValue, errorEl);
  }

  /** Parse colour rules, surface their errors, and keep Save in sync. */
  private validateColorRules(
    key: string,
    value: string,
    errorEl: HTMLElement,
  ): void {
    const { errors } = parseColorRules(value);

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

  /**
   * Render a query textarea bound to `key`, validating on every change. Errors
   * render into a sibling div and toggle the Save button — without re-rendering
   * the pane (which would blur the textarea the user is typing in).
   */
  private renderQueryField(
    containerEl: HTMLElement,
    key: string,
    initialValue: string,
    onChange: (value: string) => void,
  ): void {
    const querySetting = new Setting(containerEl)
      .setName("Query")
      .setClass("tasks-kanban-setting-query")
      .setDesc("One instruction per line.")
      .addTextArea((textArea) => {
        textArea.inputEl.rows = 8;
        textArea.inputEl.spellcheck = false;
        textArea.inputEl.placeholder = QUERY_PLACEHOLDER;
        textArea.setValue(initialValue);
        textArea.onChange((value) => {
          onChange(value);
          this.validateField(key, value, errorEl);
        });
      });

    querySetting.descEl.createEl("br");
    querySetting.descEl.createEl("a", {
      text: "See the documentation.",
      href: DOCS_URL,
    });

    const errorEl = containerEl.createDiv({
      cls: "tasks-kanban-settings-errors",
    });

    // Seed initial error state.
    this.validateField(key, initialValue, errorEl);
  }

  /**
   * Parse `value`, store its errors under `key`, render them into `errorEl`, and
   * keep the Save button's disabled state in sync.
   */
  private validateField(
    key: string,
    value: string,
    errorEl: HTMLElement,
  ): void {
    const { errors } = parseQuery(value);

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
    // Drop columns left without any symbols, or without a usable day — neither
    // could render.
    const cleanColumns = (
      columns: ColumnConfig[] | undefined,
    ): ColumnConfig[] => (columns ?? []).filter((c) => c.symbols.length > 0);
    const cleanDates = (
      columns: DateColumnConfig[] | undefined,
    ): DateColumnConfig[] =>
      (columns ?? [])
        .map((c) => ({ ...c, date: c.date.trim() }))
        .filter((c) => isValidColumnDate(c.date));

    await this.plugin.saveSettings({
      baseQuery: this.baseQuery,
      taskFormat: this.taskFormat,
      baseBoardType: this.baseSlice.boardType,
      baseColumns: cleanColumns(this.baseSlice.columns),
      baseColumnTagPrefix: this.baseSlice.columnTagPrefix,
      baseColumnOrder: this.baseSlice.columnOrder,
      baseDateField: this.baseSlice.dateField,
      baseDateColumns: cleanDates(this.baseSlice.dateColumns),
      baseCardColors: this.baseCardColors,
      boardsFolder: this.boardsFolder,
      weeklyPlannerFolder: this.weeklyPlannerFolder,
    });

    // Boards live in the vault, so they are written file by file. Deletions are
    // applied first, so a board removed and re-added in one sitting can't have
    // its new file trashed by the pending delete.
    const repository = this.plugin.getBoardRepository();
    for (const path of this.deletedBoards) {
      await repository.delete(path);
    }
    this.deletedBoards = [];

    for (const { path, board } of this.boards) {
      await repository.write(path, {
        ...board,
        columns: cleanColumns(board.columns),
        dateColumns: cleanDates(board.dateColumns),
      });
    }

    // An open board reads its own file, so make it re-read after we rewrote it.
    this.plugin.refreshOpenBoards();
  }
}

/** The base board's slice before the plugin's data has been read. */
function emptySlice(): ColumnSlice {
  return {
    boardType: "status",
    columnTagPrefix: "",
    columnOrder: "",
    dateField: DATE_FIELDS[0],
    dateColumns: [],
    columns: [],
  };
}

/** Dropdown options for the date field, in lifecycle order. */
function dateFieldOptions(): Record<string, string> {
  const options: Record<string, string> = {};
  for (const field of DATE_FIELDS) {
    options[field] = DATE_FIELD_LABELS[field];
  }
  return options;
}

/**
 * Give a freshly chosen board type something to show. A date board with no days
 * would hide every dated task, which reads as a broken board rather than an
 * unconfigured one — so it starts on today.
 */
function seedForType(slice: ColumnSlice): void {
  if (slice.boardType === "date" && slice.dateColumns.length === 0) {
    slice.dateColumns = [{ id: newColumnId(), title: "", date: todayISO() }];
  }
}

/**
 * Normalise a user-typed column-tag prefix: the code builds tags as
 * `#<prefix>_<column>`, so drop a leading '#' and any trailing separator the
 * user typed anyway, and trim whitespace (which no tag can contain).
 */
function normalizeTagPrefix(value: string): string {
  return value.trim().replace(/^#/, "").replace(/_+$/, "");
}

/** Render a status symbol for display, making whitespace visible. */
function describeSymbol(symbol: string): string {
  if (symbol === " ") {
    return "[ ]";
  }
  return `[${symbol}]`;
}
