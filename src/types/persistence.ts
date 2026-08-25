import type { DateField } from "../utils/dateFilter";
import type { SortState } from "../utils/sortTasks";
import {
  type TaskFormatSetting,
  DEFAULT_TASK_FORMAT_SETTING,
} from "../utils/taskFormat";

/**
 * How a board partitions tasks into columns. Chosen explicitly per board — the
 * type is never inferred from whether some other field happens to be filled in.
 *
 * - `status`: one column per status type, or a user-defined partition over
 *   status symbols ({@link ColumnConfig}).
 * - `tag`: one column per `#<prefix>_<column>` tag found on the tasks.
 * - `date`: one column per configured calendar day ({@link DateColumnConfig}).
 * - `week`: the seven days of **the week you are looking at**, built at render
 *   time rather than stored, so one note is the board for every week. Its
 *   filters, mutations and colour rules may carry `{{week}}`-style placeholders,
 *   substituted for that week on the way to the screen (see utils/weeklyBoard).
 */
export type BoardType = "status" | "tag" | "date" | "week";

/** The board type a board gets when it does not say. */
export const DEFAULT_BOARD_TYPE: BoardType = "status";

/**
 * Coerce a persisted board type.
 *
 * Boards written before board types were explicit carry no `boardType`; for
 * those the old implicit rule still decides, so a board that had a column-tag
 * prefix stays a tag board and everything else stays a status board.
 */
export function resolveBoardType(
  raw: unknown,
  columnTagPrefix: string,
): BoardType {
  if (raw === "status" || raw === "tag" || raw === "date" || raw === "week") {
    return raw;
  }
  return columnTagPrefix.trim() === "" ? DEFAULT_BOARD_TYPE : "tag";
}

/**
 * A user-defined column: a named partition over status symbols. The first symbol
 * is the one written to a task dropped into the column (the drop symbol). When a
 * board has no custom columns the default status columns are used instead (see
 * resolveColumns in utils/statusColumns).
 */
export interface ColumnConfig {
  /** Stable identifier (crypto.randomUUID()); also the column-fold key. */
  id: string;
  /** Display name shown in the column header. */
  title: string;
  /** Configured status symbols this column collects; symbols[0] is the drop symbol. */
  symbols: string[];
}

/**
 * A column of a date board: one exact calendar day. A task lands in it when its
 * value for the board's date field is that day; dropping a card in writes that
 * day into the task (see buildDateColumns in utils/dateColumns).
 */
export interface DateColumnConfig {
  /** Stable identifier (crypto.randomUUID()); also the column-fold key. */
  id: string;
  /** Display name; empty ⇒ the date itself is shown. */
  title: string;
  /** The exact day this column collects, as `YYYY-MM-DD`. */
  date: string;
}

/**
 * A **meta column**: a column defined by what it means rather than by one field
 * of the task.
 *
 * Where a status, tag or date column collects on a single value, a meta column
 * carries a *predicate* — filter lines in the board query language — and a
 * *mutation* — instructions in its imperative twin (see utils/taskMutation),
 * applied to a card dropped into it. The two are independent on purpose: a
 * column can gather "unplanned work" and, when something is dragged back in,
 * do whatever makes it unplanned again.
 *
 * Meta columns are added to whatever columns the board's type produces, and
 * come first — a task is shown in the first column that collects it, so a meta
 * column takes priority over the catch-all it overlaps with.
 */
export interface MetaColumnConfig {
  /** Stable identifier (crypto.randomUUID()); also the column-fold key. */
  id: string;
  /** Display name shown in the column header. */
  title: string;
  /** Filter lines a task must satisfy to land here; empty ⇒ the column is dropped. */
  filter: string;
  /** Mutation lines applied to a task dropped in; empty ⇒ a drop does nothing. */
  mutation: string;
}

/**
 * Whether a date board leads with the "No date" catch-all when it does not say.
 * On, so a board written before the setting existed keeps every column it had.
 */
export const DEFAULT_NO_DATE_COLUMN = true;

/** Coerce a persisted catch-all flag; only an explicit `false` turns it off. */
export function resolveNoDateColumn(raw: unknown): boolean {
  return raw === false ? false : DEFAULT_NO_DATE_COLUMN;
}

/**
 * A **card action**: a named mutation a user runs on one task from the card's
 * right-click menu (see components/KanbanCard).
 *
 * Same language as a meta column's mutation, and for the same reason — moving a
 * card and picking a command off a menu are the same act, said two ways. What
 * differs is the trigger: a column mutates what is dropped into it, an action
 * mutates what is asked. Each board carries its own set, so a planner's menu
 * ("Next week") and a sprint board's need not agree.
 */
export interface BoardActionConfig {
  /** Stable identifier (crypto.randomUUID()); also the menu item's key. */
  id: string;
  /** Menu label. */
  title: string;
  /** Mutation lines applied to the task; empty ⇒ the action is dropped. */
  mutation: string;
}

/**
 * The persisted plugin data: only what is **shared across every board**.
 *
 * A board's own settings live in the board — that is, in the note that carries
 * its block — so this file holds no board state at all. What is left is the
 * prefix every board's query is merged with, the colour rules every board
 * inherits, how dates are written, and where the plugin puts the notes it
 * creates.
 */
export interface PluginData {
  /** Shared query prefix applied to every board. */
  baseQuery: string;
  /**
   * How task metadata is written back to notes. `auto` reads the format from
   * the Tasks plugin; the concrete values override it for this vault.
   */
  taskFormat: TaskFormatSetting;
  /** Card-spine colour rules shared by every board; "" ⇒ none. */
  baseCardColors: string;
  /** Vault folder the board notes live in; "" ⇒ the vault root. */
  boardsFolder: string;
  /**
   * The note holding the weekly planner — one note for every week, since a week
   * board fixes no week (see {@link BoardType}). Created from the default the
   * first time the planner is opened, and the user's from then on.
   */
  weeklyBoardPath: string;
}

export const DEFAULT_PLUGIN_DATA: PluginData = {
  baseQuery: "",
  taskFormat: DEFAULT_TASK_FORMAT_SETTING,
  baseCardColors: "",
  boardsFolder: "Kanban",
  // Inside the boards folder, so the planner shows up in the board picker like
  // any other board — which is all it is.
  weeklyBoardPath: "Kanban/Weekly.md",
};

/**
 * The shape of a data file written before the canonical-query model. Read once on
 * load to migrate `selectedTags`/`sortState` into a query string, then never
 * written again. All fields optional — old files may carry any subset.
 */
export interface LegacyBoardState {
  sortState?: SortState;
  /** Bare tag names (no leading `#`). */
  selectedTags?: string[];
  /** Single-query model that preceded multiple saved boards. */
  query?: string;
}

/**
 * The own-slice state a single board reads and writes. Filtering and sorting are
 * persisted as a canonical query string; folded columns stay separate.
 */
export interface BoardOwnState {
  /** This view's own query lines (without the base prefix). */
  query: string;
  /** Which kind of columns this board has. Owned by settings, never written by a board. */
  boardType: BoardType;
  /** Column IDs currently folded on this board. */
  collapsedColumns: string[];
  /** Group keys (swimlane keys) currently folded on this board. */
  collapsedGroups: string[];
  /** Custom columns; empty ⇒ default status columns. */
  columns: ColumnConfig[];
  /** Meta columns, shown before the type's columns. Owned by settings. */
  metaColumns: MetaColumnConfig[];
  /** Card-menu actions. Owned by settings. */
  actions: BoardActionConfig[];
  /** Date columns: the field their days apply to. Owned by settings. */
  dateField: DateField;
  /** Date columns: the days shown, in order. Owned by settings. */
  dateColumns: DateColumnConfig[];
  /** Date columns: whether the "No date" catch-all leads them. Owned by settings. */
  noDateColumn: boolean;
  /** Tag-column prefix; "" ⇒ no tag columns. Owned by settings, never written by a board. */
  columnTagPrefix: string;
  /** Tag-column order; "" ⇒ alphabetical. Owned by settings, never written by a board. */
  columnOrder: string;
  /** Card-spine colour rules; "" ⇒ none. Owned by settings, never written by a board. */
  cardColors: string;
}

/**
 * Accessor passed down to a board so it can read/write its own slice and read the
 * shared base prefix, without knowing how (or where) the plugin persists them.
 */
export interface BoardStatePersistence {
  /** This board's own slice (query lines + folded columns). */
  get(): BoardOwnState;
  /** The shared base query prefix, merged on top of {@link get}'s query. */
  getBaseQuery(): string;
  /**
   * The shared card-colour rules, appended **below** this board's own (see
   * buildColorRules in KanbanBoard): the first matching rule wins, so a board's
   * own rule always beats a shared one.
   */
  getBaseCardColors(): string;
  /** Persist this board's own slice. Never writes the base prefix. */
  save(state: BoardOwnState): void | Promise<void>;
}
