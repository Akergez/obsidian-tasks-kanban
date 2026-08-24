import {
  App,
  type ButtonComponent,
  PluginSettingTab,
  Setting,
  type SettingDefinitionItem,
} from "obsidian";

import { parseQuery } from "../query/boardQuery";
import { parseColorRules } from "../utils/cardColors";
import type { ColumnConfig } from "../types/persistence";
import { BOARD_EXTENSION, type BoardFile } from "../query/boardFile";
import type { BoardEntry } from "../services/BoardRepository";
import type { StatusInfo } from "../services/TasksIntegration";
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

/** Shared description of the column-tag-prefix control (pane + settings search). */
const TAG_PREFIX_DESC =
  "Empty: columns come from task statuses. Set (e.g. 'sprint'): one column per " +
  "#sprint_<column> tag found, ordered alphabetically, plus a 'No column' column. " +
  "Dragging a card rewrites the tag.";

/** Shared description of the column-order control (pane + settings search). */
const COLUMN_ORDER_DESC =
  "Comma-separated column names (the part after the prefix), leftmost first — " +
  "e.g. 'todo, doing, done'. Columns not listed follow alphabetically. A listed " +
  "column shows up even when no task carries its tag yet. Empty: all alphabetical.";

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

/** A unique id generator for new custom columns. */
function newColumnId(): string {
  return crypto.randomUUID();
}

/**
 * Settings tab for the Tasks Kanban plugin.
 *
 * Edits the shared base board plus every `.kanban` board file in the vault.
 * All edits are kept in working copies and committed together via Save, which
 * writes the base slice to data.json and each board back to its own file; the
 * Save button is disabled while any query or colour rule has parse errors.
 */
export class TasksKanbanSettingsTab extends PluginSettingTab {
  private plugin: TasksKanbanPlugin;

  // Working copies, committed on Save.
  private baseQuery = "";
  private baseColumns: ColumnConfig[] = [];
  private baseColumnTagPrefix = "";
  private baseColumnOrder = "";
  private baseCardColors = "";
  /** Board files loaded from disk, edited in place and written back on Save. */
  private boards: { path: string; board: BoardFile }[] = [];
  private boardsFolder = "";
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
        heading: "Base board",
        items: [
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
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    const data = this.plugin.getPluginData();
    if (key === "baseQuery") {
      return data.baseQuery;
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
    if (key === "baseCardColors") {
      return data.baseCardColors;
    }
    if (key === "boardsFolder") {
      return data.boardsFolder;
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
        baseColumns: data.baseColumns,
        baseColumnTagPrefix: data.baseColumnTagPrefix,
        baseColumnOrder: data.baseColumnOrder,
        baseCardColors: data.baseCardColors,
        boardsFolder: data.boardsFolder,
        ...patch,
      });
    if (key === "baseQuery") {
      await commit({ baseQuery: value as string });
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
    if (key === "baseCardColors") {
      await commit({ baseCardColors: value as string });
      return;
    }
    if (key === "boardsFolder") {
      await commit({ boardsFolder: (value as string).trim() });
      return;
    }
  }

  display(): void {
    // Seed working copies from the plugin's current data each time the tab opens.
    const data = this.plugin.getPluginData();
    this.baseQuery = data.baseQuery;
    this.baseColumns = data.baseColumns.map((c) => ({
      ...c,
      symbols: [...c.symbols],
    }));
    this.baseColumnTagPrefix = data.baseColumnTagPrefix;
    this.baseColumnOrder = data.baseColumnOrder;
    this.baseCardColors = data.baseCardColors;
    this.boardsFolder = data.boardsFolder;
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

    new Setting(containerEl).setName("Base board").setHeading();

    containerEl.createEl("p", {
      cls: "tasks-kanban-settings-help",
      text: "The query is applied on top of every board; saved boards are merged with it. Columns apply to the default board.",
    });

    this.renderQueryField(containerEl, "base", this.baseQuery, (value) => {
      this.baseQuery = value;
    });
    this.renderTagColumnsSection(
      containerEl,
      { prefix: this.baseColumnTagPrefix, order: this.baseColumnOrder },
      (value) => {
        this.baseColumnTagPrefix = value;
      },
      (value) => {
        this.baseColumnOrder = value;
      },
    );
    this.renderCardColorsField(
      containerEl,
      "base-colors",
      this.baseCardColors,
      (value) => {
        this.baseCardColors = value;
      },
    );
    if (!this.baseColumnTagPrefix) {
      this.renderColumnsSection(containerEl, this.baseColumns, (next) => {
        this.baseColumns = next;
      });
    }

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
            this.render();
          });
      });

    this.renderQueryField(containerEl, path, board.query, (value) => {
      board.query = value;
    });
    this.renderTagColumnsSection(
      containerEl,
      { prefix: board.columnTagPrefix, order: board.columnOrder },
      (value) => {
        board.columnTagPrefix = value;
      },
      (value) => {
        board.columnOrder = value;
      },
    );
    this.renderCardColorsField(
      containerEl,
      `${path}-colors`,
      board.cardColors,
      (value) => {
        board.cardColors = value;
      },
    );
    if (!board.columnTagPrefix) {
      this.renderColumnsSection(containerEl, board.columns, (next) => {
        board.columns = next;
      });
    }
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
   * Render the tag-column fields for one board: the prefix, plus the column
   * order once the prefix is set.
   *
   * A non-empty prefix switches the board to tag columns: one column per
   * distinct `#<prefix>_<column>` tag found on the tasks, plus a catch-all for
   * tasks carrying none, and dropping a card rewrites that tag instead of the
   * status symbol. Leaving it empty keeps the status columns, so the prefix
   * field re-renders the pane to show or hide what depends on it.
   */
  private renderTagColumnsSection(
    containerEl: HTMLElement,
    values: { prefix: string; order: string },
    onPrefixChange: (value: string) => void,
    onOrderChange: (value: string) => void,
  ): void {
    new Setting(containerEl)
      .setName("Column tag prefix")
      .setDesc(TAG_PREFIX_DESC)
      .addText((text) => {
        text
          .setPlaceholder("sprint")
          .setValue(values.prefix)
          .onChange((value) => {
            onPrefixChange(normalizeTagPrefix(value));
          });
        // Showing/hiding the fields below needs a full re-render, which would
        // blur the field mid-typing — so only do it once the user leaves.
        text.inputEl.addEventListener("blur", () => this.render());
      });

    if (!values.prefix) {
      return;
    }

    new Setting(containerEl)
      .setName("Column order")
      .setDesc(COLUMN_ORDER_DESC)
      .addText((text) => {
        text
          .setPlaceholder("todo, doing, done")
          .setValue(values.order)
          .onChange(onOrderChange);
      });
  }

  /**
   * Render the custom-columns editor for one board's column slice.
   *
   * A toggle switches between default status columns (`columns` empty) and a
   * custom set. When custom, each column has a name, a status-symbol multi-select
   * (the first checked symbol is the drop target), and a delete button, plus an
   * "Add column" button. Structural edits (toggle/add/delete) re-render the pane;
   * `onChange` hands the updated array back so the caller's working copy stays in
   * sync (the base slice is a field, a board's is a property).
   */
  private renderColumnsSection(
    containerEl: HTMLElement,
    columns: ColumnConfig[],
    onChange: (columns: ColumnConfig[]) => void,
  ): void {
    const custom = columns.length > 0;

    new Setting(containerEl)
      .setName("Custom columns")
      .setDesc(
        "Off: one column per status type. On: define columns as status-symbol partitions.",
      )
      .addToggle((toggle) => {
        toggle.setValue(custom).onChange((value) => {
          // Turning on seeds one empty column; turning off clears the set.
          onChange(
            value ? [{ id: newColumnId(), title: "", symbols: [] }] : [],
          );
          this.render();
        });
      });

    if (!custom) {
      return;
    }

    const statuses = this.plugin.getStatuses();
    for (const column of columns) {
      this.renderColumnRow(containerEl, column, columns, onChange, statuses);
    }

    new Setting(containerEl).addButton((button) => {
      button.setButtonText("Add column").onClick(() => {
        onChange([...columns, { id: newColumnId(), title: "", symbols: [] }]);
        this.render();
      });
    });
  }

  /** Render one custom-column row: name, status checkboxes, delete. */
  private renderColumnRow(
    containerEl: HTMLElement,
    column: ColumnConfig,
    columns: ColumnConfig[],
    onChange: (columns: ColumnConfig[]) => void,
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
            onChange(columns.filter((c) => c.id !== column.id));
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
    // Drop columns left without a name or any symbols — they can't render.
    const clean = (columns: ColumnConfig[] | undefined): ColumnConfig[] =>
      (columns ?? []).filter((c) => c.symbols.length > 0);

    await this.plugin.saveSettings({
      baseQuery: this.baseQuery,
      baseColumns: clean(this.baseColumns),
      baseColumnTagPrefix: this.baseColumnTagPrefix,
      baseColumnOrder: this.baseColumnOrder,
      baseCardColors: this.baseCardColors,
      boardsFolder: this.boardsFolder,
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
      await repository.write(path, { ...board, columns: clean(board.columns) });
    }

    // An open board reads its own file, so make it re-read after we rewrote it.
    this.plugin.refreshOpenBoards();
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
