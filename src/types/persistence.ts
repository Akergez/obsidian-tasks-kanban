import { type DateField, DEFAULT_DATE_FIELD } from "../utils/dateFilter";
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
 */
export type BoardType = "status" | "tag" | "date";

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
  if (raw === "status" || raw === "tag" || raw === "date") {
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
 * A single saved board: a named view. Its `query` holds only the view's own
 * lines (its slice; filters + sort + group); at render time that is merged on
 * top of the shared base query (see {@link PluginData.baseQuery}).
 *
 * This is the legacy in-data.json shape, kept only so old data files can be
 * drained into `.kanban` files (see migrateSavedBoardsToFiles). It predates
 * explicit board types, so `boardType` is absent and inferred on migration.
 */
export interface SavedBoard {
  /** Stable identifier (crypto.randomUUID()), used to match open boards. */
  id: string;
  /** Which kind of columns this board has; absent ⇒ inferred from the prefix. */
  boardType?: BoardType;
  /** Display name, shown in the picker and on the board's tab. */
  name: string;
  /** Canonical query lines for this view's own slice (no base prefix). */
  query: string;
  /** Column IDs (see KanbanColumnConfig.id) folded on this view's board. */
  collapsedColumns: string[];
  /** Group keys (swimlane keys) folded on this view's board. */
  collapsedGroups?: string[];
  /** Custom columns; absent/empty ⇒ default status columns. */
  columns?: ColumnConfig[];
  /** Tag columns: shared prefix of the board's `#<prefix>_<column>` tags; "" ⇒ off. */
  columnTagPrefix?: string;
  /** Tag columns: comma-separated column parts, leftmost first; "" ⇒ alphabetical. */
  columnOrder?: string;
  /** Card-spine colour rules, one `<filter> -> <colour>` per line; "" ⇒ none. */
  cardColors?: string;
}

/**
 * The persisted plugin data.
 *
 * `baseQuery` is a shared prefix merged into every board (the base board and
 * each saved board). The base board is itself openable as the default view.
 */
export interface PluginData {
  /** Shared query prefix applied to every board. */
  baseQuery: string;
  /**
   * How task metadata is written back to notes. `auto` reads the format from
   * the Tasks plugin; the concrete values override it for this vault.
   */
  taskFormat: TaskFormatSetting;
  /** Which kind of columns the base-only board has. */
  baseBoardType: BoardType;
  /** Date columns: the field the base-only board's columns are days of. */
  baseDateField: DateField;
  /** Date columns: the days the base-only board shows, in order. */
  baseDateColumns: DateColumnConfig[];
  /** Folded columns for the base-only board. */
  baseCollapsedColumns: string[];
  /** Folded group keys for the base-only board. */
  baseCollapsedGroups: string[];
  /** Custom columns for the base-only board; empty ⇒ default status columns. */
  baseColumns: ColumnConfig[];
  /** Meta columns for the base-only board, shown before its type's columns. */
  baseMetaColumns: MetaColumnConfig[];
  /** Tag-column prefix for the base-only board; "" ⇒ status columns. */
  baseColumnTagPrefix: string;
  /** Tag-column order for the base-only board; "" ⇒ alphabetical. */
  baseColumnOrder: string;
  /** Card-spine colour rules for the base-only board; "" ⇒ none. */
  baseCardColors: string;
  /** Vault folder holding the `.kanban` board files; "" ⇒ the vault root. */
  boardsFolder: string;
  /** Vault folder the weekly planner's boards live in; "" ⇒ the vault root. */
  weeklyPlannerFolder: string;
  /**
   * Legacy in-data.json boards. Drained into `.kanban` files on first load
   * (see migrateSavedBoardsToFiles) and then always empty.
   */
  savedBoards: SavedBoard[];
}

export const DEFAULT_PLUGIN_DATA: PluginData = {
  baseQuery: "",
  taskFormat: DEFAULT_TASK_FORMAT_SETTING,
  baseBoardType: DEFAULT_BOARD_TYPE,
  baseDateField: DEFAULT_DATE_FIELD,
  baseDateColumns: [],
  baseCollapsedColumns: [],
  baseCollapsedGroups: [],
  baseColumns: [],
  baseMetaColumns: [],
  baseColumnTagPrefix: "",
  baseColumnOrder: "",
  baseCardColors: "",
  boardsFolder: "Kanban",
  // Nested inside the boards folder by default, so weekly boards also show up
  // in the board picker and the settings pane.
  weeklyPlannerFolder: "Kanban/Weekly",
  savedBoards: [],
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
  /** Folded columns under the single-query model. */
  collapsedColumns?: string[];
  /** Pre-rename key for {@link PluginData.savedBoards}; same element shape. */
  savedQueries?: SavedBoard[];
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
  /** Date columns: the field their days apply to. Owned by settings. */
  dateField: DateField;
  /** Date columns: the days shown, in order. Owned by settings. */
  dateColumns: DateColumnConfig[];
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
