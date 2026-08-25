import { App, Modal, Setting } from "obsidian";

import { parseQuery } from "../query/boardQuery";
import { parseColorRules } from "../utils/cardColors";
import { metaColumnErrors } from "../utils/metaColumns";
import type { StatusInfo } from "../services/TasksIntegration";
import type {
  BoardType,
  ColumnConfig,
  DateColumnConfig,
  MetaColumnConfig,
} from "../types/persistence";
import {
  DATE_FIELDS,
  DATE_FIELD_LABELS,
  isValidColumnDate,
  todayISO,
} from "../utils/dateColumns";
import type { DateField } from "../utils/dateFilter";

/**
 * Everything about a board a user edits by hand, as one editable draft.
 *
 * This is exactly the slice {@link BoardOwnState} owns minus the fold state,
 * which the board itself maintains — the modal never touches which columns are
 * collapsed.
 */
export interface BoardSettingsDraft {
  query: string;
  boardType: BoardType;
  columnTagPrefix: string;
  columnOrder: string;
  dateField: DateField;
  dateColumns: DateColumnConfig[];
  noDateColumn: boolean;
  columns: ColumnConfig[];
  metaColumns: MetaColumnConfig[];
  cardColors: string;
}

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

const BOARD_TYPE_LABELS: Record<BoardType, string> = {
  status: "Status columns",
  tag: "Tag columns",
  date: "Date columns",
};

const BOARD_TYPE_DESC =
  "What the columns of this board are. Status: one column per status type, or " +
  "your own partition over status symbols. Tag: one column per #<prefix>_<column> " +
  "tag on your tasks. Date: one column per day you name, on one date field.";

const TAG_PREFIX_DESC =
  "Shared prefix of this board's column tags (e.g. 'sprint'): one column per " +
  "#sprint_<column> tag found, plus a 'No column' column. Dragging a card " +
  "rewrites the tag.";

const COLUMN_ORDER_DESC =
  "Comma-separated column names (the part after the prefix), leftmost first — " +
  "e.g. 'todo, doing, done'. Columns not listed follow alphabetically. Empty: " +
  "all alphabetical.";

const DATE_FIELD_DESC =
  "The task date this board's columns are days of. Dragging a card writes that " +
  "day into this field.";

const DATE_COLUMNS_DESC =
  "One column per exact day. A task whose date matches no column is hidden.";

const NO_DATE_COLUMN_DESC =
  "Lead with a 'No date' column holding every task with no date in this field; " +
  "dropping a card there clears it. Turn it off when a meta column already " +
  "pools those tasks, as the weekly planner's does.";

const META_COLUMNS_DESC =
  "Columns defined by a filter instead of a single field. A card lands in the " +
  "first column that collects it, and meta columns come first — so they win " +
  "over the column they overlap. Dropping a card in applies the mutation.";

const META_FILTER_PLACEHOLDER = [
  "not done",
  "(no scheduled date) OR (scheduled before today)",
].join("\n");

const META_MUTATION_PLACEHOLDER = ["set not done", "clear scheduled date"].join(
  "\n",
);

const CARD_COLORS_DESC =
  "One rule per line: a filter, then '->', then a CSS colour. The first matching " +
  "rule paints that card's left edge, so put the most specific rule on top. The " +
  "shared rules from plugin settings are appended below these, so a board rule " +
  "always wins over a shared one.";

/** A unique id generator for new columns. */
function newColumnId(): string {
  return crypto.randomUUID();
}

/**
 * Give a freshly chosen board type something to show. A date board with no days
 * would hide every dated task, which reads as a broken board rather than an
 * unconfigured one — so it starts on today.
 */
function seedForType(draft: BoardSettingsDraft): void {
  if (draft.boardType === "date" && draft.dateColumns.length === 0) {
    draft.dateColumns = [{ id: newColumnId(), title: "", date: todayISO() }];
  }
}

/** Render a status symbol for display, making whitespace visible. */
function describeSymbol(symbol: string): string {
  return symbol === " " ? "[ ]" : `[${symbol}]`;
}

/**
 * Normalise a user-typed column-tag prefix: the code builds tags as
 * `#<prefix>_<column>`, so drop a leading '#' and any trailing separator the
 * user typed anyway, and trim whitespace (which no tag can contain).
 */
function normalizeTagPrefix(value: string): string {
  return value.trim().replace(/^#/, "").replace(/_+$/, "");
}

/**
 * The settings of **one** board, edited where the board is.
 *
 * Boards are files and a vault accumulates them — a weekly planner alone adds
 * one every week — so a plugin-settings pane listing every board grows without
 * bound. A board's own settings therefore live on the board, and the settings
 * pane keeps only what is shared across all of them.
 *
 * Edits are held in a draft and committed on Save, so Cancel really cancels and
 * a half-typed query never reaches the board. Save stays disabled while any
 * query, colour rule or column day is unusable.
 */
export class BoardSettingsModal extends Modal {
  private readonly draft: BoardSettingsDraft;
  private readonly statuses: StatusInfo[];
  private readonly onSubmit: (draft: BoardSettingsDraft) => void;
  private readonly title: string;

  /** Parse errors keyed by field, so one bad field alone gates Save. */
  private readonly errors = new Map<string, string[]>();
  private bodyEl!: HTMLElement;
  private saveButton: HTMLButtonElement | null = null;

  constructor(
    app: App,
    title: string,
    draft: BoardSettingsDraft,
    statuses: StatusInfo[],
    onSubmit: (draft: BoardSettingsDraft) => void,
  ) {
    super(app);
    this.title = title;
    // Deep-copy the parts we mutate, so Cancel leaves the board untouched.
    this.draft = {
      ...draft,
      dateColumns: draft.dateColumns.map((c) => ({ ...c })),
      columns: draft.columns.map((c) => ({ ...c, symbols: [...c.symbols] })),
      metaColumns: draft.metaColumns.map((c) => ({ ...c })),
    };
    this.statuses = statuses;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("tasks-kanban-board-settings-modal");
    contentEl.createEl("h3", { text: this.title });

    this.bodyEl = contentEl.createDiv({
      cls: "tasks-kanban-board-settings-body",
    });

    const buttons = contentEl.createDiv({
      cls: "tasks-kanban-query-modal-buttons",
    });
    const cancel = buttons.createEl("button", {
      text: "Cancel",
      attr: { type: "button" },
    });
    cancel.addEventListener("click", () => this.close());

    this.saveButton = buttons.createEl("button", {
      cls: "mod-cta",
      text: "Save",
      attr: { type: "button" },
    });
    this.saveButton.addEventListener("click", () => {
      if (this.hasErrors()) {
        return;
      }
      this.onSubmit(this.cleaned());
      this.close();
    });

    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /**
   * Drop what could not render: a status column with no symbols, a day that is
   * not a real date. Both are already flagged, but Save must never write one.
   */
  private cleaned(): BoardSettingsDraft {
    return {
      ...this.draft,
      columns: this.draft.columns.filter((c) => c.symbols.length > 0),
      dateColumns: this.draft.dateColumns
        .map((c) => ({ ...c, date: c.date.trim() }))
        .filter((c) => isValidColumnDate(c.date)),
      // A meta column with no usable filter could collect nothing; Save is
      // blocked on it, so this only guards against an empty leftover row.
      metaColumns: this.draft.metaColumns.filter((c) => c.filter.trim() !== ""),
    };
  }

  /** (Re)build the body. Called whenever the set of visible fields changes. */
  private render(): void {
    this.bodyEl.empty();
    this.renderQueryField(this.bodyEl);
    this.renderBoardType(this.bodyEl);
    this.renderMetaColumnFields(this.bodyEl);
    this.renderCardColorsField(this.bodyEl);
  }

  private renderQueryField(containerEl: HTMLElement): void {
    const setting = new Setting(containerEl)
      .setName("Query")
      .setClass("tasks-kanban-setting-query")
      .setDesc("One instruction per line. Merged with the shared base query.")
      .addTextArea((textArea) => {
        textArea.inputEl.rows = 6;
        textArea.inputEl.spellcheck = false;
        textArea.inputEl.placeholder = QUERY_PLACEHOLDER;
        textArea.setValue(this.draft.query);
        textArea.onChange((value) => {
          this.draft.query = value;
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
    this.validate("query", parseQuery(this.draft.query).errors, errorEl);
  }

  /**
   * Meta columns: any number of them, on any board type. Each is a title, a
   * predicate (filter lines) and a mutation (what a drop writes).
   */
  private renderMetaColumnFields(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Meta columns")
      .setDesc(META_COLUMNS_DESC)
      .addButton((button) => {
        button.setButtonText("Add meta column").onClick(() => {
          this.draft.metaColumns = [
            ...this.draft.metaColumns,
            { id: newColumnId(), title: "", filter: "", mutation: "" },
          ];
          this.render();
        });
      });

    const errorEl = containerEl.createDiv({
      cls: "tasks-kanban-settings-errors",
    });

    for (const column of this.draft.metaColumns) {
      new Setting(containerEl)
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
              this.draft.metaColumns = this.draft.metaColumns.filter(
                (c) => c.id !== column.id,
              );
              this.render();
            });
        });

      new Setting(containerEl)
        .setClass("tasks-kanban-setting-query")
        .setName("Filter")
        .setDesc("Which tasks this column collects. One filter per line.")
        .addTextArea((textArea) => {
          textArea.inputEl.rows = 3;
          textArea.inputEl.spellcheck = false;
          textArea.inputEl.placeholder = META_FILTER_PLACEHOLDER;
          textArea.setValue(column.filter);
          textArea.onChange((value) => {
            column.filter = value;
            this.validateMetaColumns(errorEl);
          });
        });

      new Setting(containerEl)
        .setClass("tasks-kanban-setting-query")
        .setName("Mutation")
        .setDesc("What a card dropped here becomes. One instruction per line.")
        .addTextArea((textArea) => {
          textArea.inputEl.rows = 3;
          textArea.inputEl.spellcheck = false;
          textArea.inputEl.placeholder = META_MUTATION_PLACEHOLDER;
          textArea.setValue(column.mutation);
          textArea.onChange((value) => {
            column.mutation = value;
            this.validateMetaColumns(errorEl);
          });
        });
    }

    this.validateMetaColumns(errorEl);
  }

  /** Reject a meta column that could not collect, or a line neither parser reads. */
  private validateMetaColumns(errorEl: HTMLElement): void {
    this.validate("meta", metaColumnErrors(this.draft.metaColumns), errorEl);
  }

  private renderCardColorsField(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Card colours")
      .setClass("tasks-kanban-setting-query")
      .setDesc(CARD_COLORS_DESC)
      .addTextArea((textArea) => {
        textArea.inputEl.rows = 4;
        textArea.inputEl.spellcheck = false;
        textArea.inputEl.placeholder = CARD_COLORS_PLACEHOLDER;
        textArea.setValue(this.draft.cardColors);
        textArea.onChange((value) => {
          this.draft.cardColors = value;
          this.validate("colors", parseColorRules(value).errors, errorEl);
        });
      });

    const errorEl = containerEl.createDiv({
      cls: "tasks-kanban-settings-errors",
    });
    this.validate(
      "colors",
      parseColorRules(this.draft.cardColors).errors,
      errorEl,
    );
  }

  /**
   * The board-type picker, then only the fields that type uses. The other
   * types' settings stay in the draft while hidden, so switching back restores
   * them.
   */
  private renderBoardType(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Board type")
      .setDesc(BOARD_TYPE_DESC)
      .addDropdown((dropdown) => {
        dropdown
          .addOptions(BOARD_TYPE_LABELS)
          .setValue(this.draft.boardType)
          .onChange((value) => {
            this.draft.boardType = value as BoardType;
            seedForType(this.draft);
            this.render();
          });
      });

    if (this.draft.boardType === "tag") {
      this.renderTagColumnFields(containerEl);
      return;
    }
    if (this.draft.boardType === "date") {
      this.renderDateColumnFields(containerEl);
      return;
    }
    this.renderStatusColumnFields(containerEl);
  }

  private renderTagColumnFields(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Column tag prefix")
      .setDesc(TAG_PREFIX_DESC)
      .addText((text) => {
        text
          .setPlaceholder("sprint")
          .setValue(this.draft.columnTagPrefix)
          .onChange((value) => {
            this.draft.columnTagPrefix = normalizeTagPrefix(value);
          });
      });

    new Setting(containerEl)
      .setName("Column order")
      .setDesc(COLUMN_ORDER_DESC)
      .addText((text) => {
        text
          .setPlaceholder("todo, doing, done")
          .setValue(this.draft.columnOrder)
          .onChange((value) => {
            this.draft.columnOrder = value;
          });
      });
  }

  private renderDateColumnFields(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Date field")
      .setDesc(DATE_FIELD_DESC)
      .addDropdown((dropdown) => {
        const options: Record<string, string> = {};
        for (const field of DATE_FIELDS) {
          options[field] = DATE_FIELD_LABELS[field];
        }
        dropdown
          .addOptions(options)
          .setValue(this.draft.dateField)
          .onChange((value) => {
            this.draft.dateField = value as DateField;
          });
      });

    new Setting(containerEl)
      .setName("No date column")
      .setDesc(NO_DATE_COLUMN_DESC)
      .addToggle((toggle) => {
        toggle.setValue(this.draft.noDateColumn).onChange((value) => {
          this.draft.noDateColumn = value;
        });
      });

    new Setting(containerEl)
      .setName("Date columns")
      .setDesc(DATE_COLUMNS_DESC)
      .addButton((button) => {
        button.setButtonText("Add day").onClick(() => {
          this.draft.dateColumns = [
            ...this.draft.dateColumns,
            { id: newColumnId(), title: "", date: todayISO() },
          ];
          this.render();
        });
      });

    const errorEl = containerEl.createDiv({
      cls: "tasks-kanban-settings-errors",
    });

    for (const column of this.draft.dateColumns) {
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
            this.validateDateColumns(errorEl);
          });
        })
        .addExtraButton((button) => {
          button
            .setIcon("trash")
            .setTooltip("Delete column")
            .onClick(() => {
              this.draft.dateColumns = this.draft.dateColumns.filter(
                (c) => c.id !== column.id,
              );
              this.render();
            });
        });
    }

    this.validateDateColumns(errorEl);
  }

  /** Reject unusable days: a blank one, a non-date, or a repeated one. */
  private validateDateColumns(errorEl: HTMLElement): void {
    const errors: string[] = [];
    const seen = new Set<string>();
    this.draft.dateColumns.forEach((column, index) => {
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
    this.validate("dates", errors, errorEl);
  }

  /**
   * Status boards: the default status columns, or a custom set. Each custom
   * column is a partition over status symbols; the first checked symbol is the
   * one a drop writes.
   */
  private renderStatusColumnFields(containerEl: HTMLElement): void {
    const custom = this.draft.columns.length > 0;

    new Setting(containerEl)
      .setName("Custom columns")
      .setDesc(
        "Off: one column per status type. On: define columns as status-symbol partitions.",
      )
      .addToggle((toggle) => {
        toggle.setValue(custom).onChange((value) => {
          this.draft.columns = value
            ? [{ id: newColumnId(), title: "", symbols: [] }]
            : [];
          this.render();
        });
      });

    if (!custom) {
      return;
    }

    for (const column of this.draft.columns) {
      this.renderColumnRow(containerEl, column);
    }

    new Setting(containerEl).addButton((button) => {
      button.setButtonText("Add column").onClick(() => {
        this.draft.columns = [
          ...this.draft.columns,
          { id: newColumnId(), title: "", symbols: [] },
        ];
        this.render();
      });
    });
  }

  private renderColumnRow(
    containerEl: HTMLElement,
    column: ColumnConfig,
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
            this.draft.columns = this.draft.columns.filter(
              (c) => c.id !== column.id,
            );
            this.render();
          });
      });

    // Keep `symbols` ordered to match the status list, so the drop symbol (the
    // first one) is predictable rather than click-order dependent.
    const list = setting.controlEl.createDiv({
      cls: "tasks-kanban-column-symbols",
    });
    for (const status of this.statuses) {
      const label = list.createEl("label", {
        cls: "tasks-kanban-column-symbol",
      });
      const checkbox = label.createEl("input", { type: "checkbox" });
      checkbox.checked = column.symbols.includes(status.symbol);
      checkbox.addEventListener("change", () => {
        column.symbols = this.statuses
          .map((s) => s.symbol)
          .filter((symbol) =>
            symbol === status.symbol
              ? checkbox.checked
              : column.symbols.includes(symbol),
          );
        this.renderColumnHint(hint, column);
      });
      label.createSpan({
        cls: "tasks-kanban-column-symbol-text",
        text: `${describeSymbol(status.symbol)} ${status.name}`,
      });
    }

    const hint = setting.controlEl.createDiv({
      cls: "tasks-kanban-column-hint",
    });
    this.renderColumnHint(hint, column);
  }

  /** Show which symbol a drop writes (the first selected), or a prompt if none. */
  private renderColumnHint(hint: HTMLElement, column: ColumnConfig): void {
    hint.empty();
    if (column.symbols.length === 0) {
      hint.setText("Select at least one status.");
      return;
    }
    const drop = column.symbols[0];
    const name = this.statuses.find((s) => s.symbol === drop)?.name ?? drop;
    hint.setText(`Dropped cards become: ${describeSymbol(drop)} ${name}`);
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

    if (this.saveButton) {
      this.saveButton.disabled = this.hasErrors();
    }
  }

  private hasErrors(): boolean {
    return this.errors.size > 0;
  }
}
