import { setIcon, type App } from "obsidian";

import type { Task } from "../services/TasksIntegration";
import { TasksIntegration } from "../services/TasksIntegration";
import { KanbanLane } from "./KanbanLane";
import { SearchBar } from "./SearchBar";
import { SortBar } from "./SortBar";
import { GroupBar } from "./GroupBar";
import { WeekBar } from "./WeekBar";
import { QueryModal } from "./QueryModal";
import {
  BoardSettingsModal,
  type BoardSettingsDraft,
} from "./BoardSettingsModal";
import { resolveColumns } from "../utils/statusColumns";
import type { KanbanColumnConfig } from "../utils/statusColumns";
import { buildTagColumns, parseColumnOrder } from "../utils/tagColumns";
import { buildDateColumns } from "../utils/dateColumns";
import {
  addWeeks,
  renderWeek,
  startOfWeek,
  weekColumns,
} from "../utils/weeklyBoard";
import { buildMetaColumns } from "../utils/metaColumns";
import { buildBoardActions, type BoardAction } from "../utils/boardActions";
import type { DateField } from "../utils/dateFilter";
import { parseColorRules, type ColorRule } from "../utils/cardColors";
import { nestTasks, type SubTask } from "../utils/taskHierarchy";
import { getUniqueTags } from "../utils/searchFilter";
import { groupTasks, type TaskGroup } from "../utils/groupTasks";
import {
  applyBoardQuery,
  getExcludedTags,
  getGroup,
  getSort,
  getTags,
  getTitle,
  mergeQueries,
  parseQuery,
  serializeQuery,
  withExcludedTags,
  withGroup,
  withSort,
  withTags,
  withTitle,
  type BoardQuery,
} from "../query/boardQuery";
import type {
  BoardActionConfig,
  BoardStatePersistence,
  BoardType,
  ColumnConfig,
  DateColumnConfig,
  MetaColumnConfig,
} from "../types/persistence";

export type { KanbanColumnConfig } from "../utils/statusColumns";

/**
 * The Kanban board component
 */
export class KanbanBoard {
  private container: HTMLElement;
  private app: App;
  private boardEl!: HTMLElement;
  private tasksIntegration: TasksIntegration;
  private lanes: KanbanLane[] = [];
  /** Group keys currently rendered, parallel to {@link lanes}; for reconcile. */
  private laneKeys: string[] = [];
  private searchBar: SearchBar;
  private sortBar: SortBar;
  private groupBar: GroupBar;
  private weekBar: WeekBar;
  private persistence: BoardStatePersistence;
  /** Every task last received, exactly as the cache handed it over. */
  private rawTasks: Task[] = [];
  /** Root tasks (one card each), before query filtering. */
  private allTasks: Task[] = [];
  /** Sub-tasks to render inside each root's card, keyed by {@link taskKey}. */
  private subTasksOf = new Map<string, SubTask[]>();
  /** The canonical board query: filters + sort + group. Bars edit slices of it. */
  private boardQuery: BoardQuery;
  /** Shared base query merged on top of {@link boardQuery} at render time. */
  private baseQuery: BoardQuery;
  /** Column IDs currently folded; persisted across reopens. */
  private collapsedColumns: Set<string>;
  /** Group keys (swimlane keys) currently folded; persisted across reopens. */
  private collapsedGroups: Set<string>;
  /** Which kind of columns this board has. Set in settings. */
  private boardType: BoardType;
  /**
   * How many weeks away from this one a week board is showing; 0 is the week we
   * are in.
   *
   * Deliberately *not* persisted: a planner should open on the week you are in,
   * whatever you were looking at last time. It is also the only board state
   * that never reaches the file — which is the whole point of a week board.
   */
  private weekOffset = 0;
  /** Custom columns for this board; empty ⇒ default status columns. */
  private columnConfigs: ColumnConfig[];
  /** Meta columns for this board, rendered before the type's columns. */
  private metaColumns: MetaColumnConfig[];
  /** Card-menu actions for this board, as configured. */
  private actionConfigs: BoardActionConfig[];
  /** {@link actionConfigs} parsed; rebuilt whenever the raw setting changes. */
  private actions: BoardAction[] = [];
  /** Tag-column prefix for this board. Set in settings. */
  private columnTagPrefix: string;
  /** Tag-column order for this board; "" ⇒ alphabetical. Set in settings. */
  private columnOrder: string;
  /** Date-column field for this board. Set in settings. */
  private dateField: DateField;
  /** Date columns for this board, in order. Set in settings. */
  private dateColumns: DateColumnConfig[];
  /** Whether the date columns lead with the "No date" catch-all. Set in settings. */
  private noDateColumn: boolean;
  /** Raw card-colour rules for this board, as typed in settings. */
  private cardColors: string;
  /** {@link cardColors} parsed; rebuilt whenever the raw setting changes. */
  private colorRules: ColorRule[] = [];

  /**
   * Switch the note this board is written in to source mode, at the board's
   * own block — provided by whoever renders the board, since only they know
   * where its text lives. Absent ⇒ no "Edit text" button.
   */
  private readonly onEditSource?: () => void;

  constructor(
    container: HTMLElement,
    app: App,
    tasksIntegration: TasksIntegration,
    persistence: BoardStatePersistence,
    onEditSource?: () => void,
  ) {
    this.container = container;
    this.app = app;
    this.tasksIntegration = tasksIntegration;
    this.persistence = persistence;
    this.onEditSource = onEditSource;

    // Hydrate the canonical query from the persisted query string.
    const initial = persistence.get();
    this.boardQuery = parseQuery(initial.query).query;
    this.baseQuery = parseQuery(persistence.getBaseQuery()).query;
    this.collapsedColumns = new Set(initial.collapsedColumns);
    this.collapsedGroups = new Set(initial.collapsedGroups);
    this.boardType = initial.boardType;
    this.columnConfigs = initial.columns;
    this.metaColumns = initial.metaColumns;
    this.actionConfigs = initial.actions;
    this.columnTagPrefix = initial.columnTagPrefix;
    this.columnOrder = initial.columnOrder;
    this.dateField = initial.dateField;
    this.dateColumns = initial.dateColumns;
    this.noDateColumn = initial.noDateColumn;
    this.cardColors = initial.cardColors;
    this.rebuildForWeek();

    // Search, sort, and query-edit controls sit above the board in a shared row.
    const header = this.container.createDiv({ cls: "tasks-kanban-header" });
    this.searchBar = new SearchBar(
      header,
      (state) => {
        this.boardQuery = withTitle(
          withTags(
            withExcludedTags(this.boardQuery, state.excludedTags ?? []),
            state.selectedTags,
          ),
          state.titleQuery,
        );
        this.persistState();
        this.applyQuery();
      },
      getTags(this.boardQuery),
      getExcludedTags(this.boardQuery),
    );
    // Seed the title input from the query (description slice).
    this.searchBar.setState({
      titleQuery: getTitle(this.boardQuery),
      selectedTags: getTags(this.boardQuery),
      excludedTags: getExcludedTags(this.boardQuery),
    });
    this.sortBar = new SortBar(
      header,
      (state) => {
        this.boardQuery = withSort(this.boardQuery, state);
        this.persistState();
        this.applyQuery();
      },
      getSort(this.boardQuery),
    );
    this.groupBar = new GroupBar(
      header,
      (state) => {
        this.boardQuery = withGroup(this.boardQuery, state);
        this.persistState();
        this.applyQuery();
      },
      getGroup(this.boardQuery),
    );

    // Only a week board shows it; setWeek hides it on every other kind.
    this.weekBar = new WeekBar(header, {
      step: (delta) => this.stepWeek(delta),
      today: () => this.showWeek(0),
    });
    this.syncWeekBar();

    this.createQueryButton(header);
    this.createSettingsButton(header);
    this.createEditSourceButton(header);

    // The lanes render into their own board sub-element.
    this.boardEl = this.container.createDiv({ cls: "tasks-kanban-board" });
  }

  /**
   * Add the "Edit query" header button that opens the raw-query modal.
   */
  private createQueryButton(header: HTMLElement) {
    const button = header.createEl("button", {
      cls: "tasks-kanban-query-button",
      attr: { type: "button", "aria-label": "Edit query" },
    });
    setIcon(button, "filter");
    button.addEventListener("click", () => this.openQueryModal());
  }

  /**
   * Open the query modal, then push the edited query into the bars and re-render.
   */
  private openQueryModal() {
    new QueryModal(this.app, this.boardQuery, (query) => {
      this.boardQuery = query;
      this.searchBar.setState({
        titleQuery: getTitle(query),
        selectedTags: getTags(query),
        excludedTags: getExcludedTags(query),
      });
      this.sortBar.setState(getSort(query));
      this.groupBar.setState(getGroup(query));
      this.persistState();
      this.applyQuery();
    }).open();
  }

  /**
   * Add the "Edit text" header button: the way out of the rendered board and
   * into the document behind it, for anything the modals do not cover.
   */
  private createEditSourceButton(header: HTMLElement) {
    if (!this.onEditSource) {
      return;
    }
    const button = header.createEl("button", {
      cls: "tasks-kanban-query-button",
      attr: { type: "button", "aria-label": "Edit board text" },
    });
    setIcon(button, "code");
    button.addEventListener("click", () => this.onEditSource?.());
  }

  /**
   * Add the "Board settings" header button. A board's own settings live on the
   * board, not in the plugin's settings pane: boards are files and a vault
   * accumulates them, so a pane listing every board would grow without bound.
   */
  private createSettingsButton(header: HTMLElement) {
    const button = header.createEl("button", {
      cls: "tasks-kanban-query-button",
      attr: { type: "button", "aria-label": "Board settings" },
    });
    setIcon(button, "settings");
    button.addEventListener("click", () => this.openSettingsModal());
  }

  /**
   * Open this board's settings, then apply and persist whatever comes back.
   * The modal hands over a whole draft, so one Save is one write.
   */
  private openSettingsModal() {
    const draft: BoardSettingsDraft = {
      query: serializeQuery(this.boardQuery),
      boardType: this.boardType,
      columnTagPrefix: this.columnTagPrefix,
      columnOrder: this.columnOrder,
      dateField: this.dateField,
      dateColumns: this.dateColumns,
      noDateColumn: this.noDateColumn,
      columns: this.columnConfigs,
      metaColumns: this.metaColumns,
      actions: this.actionConfigs,
      cardColors: this.cardColors,
    };

    new BoardSettingsModal(
      this.app,
      "Board settings",
      draft,
      this.tasksIntegration.getStatuses(),
      (next) => {
        this.boardQuery = parseQuery(next.query).query;
        this.boardType = next.boardType;
        this.columnTagPrefix = next.columnTagPrefix;
        this.columnOrder = next.columnOrder;
        this.dateField = next.dateField;
        this.dateColumns = next.dateColumns;
        this.noDateColumn = next.noDateColumn;
        this.columnConfigs = next.columns;
        this.metaColumns = next.metaColumns;
        this.actionConfigs = next.actions;
        this.cardColors = next.cardColors;
        this.rebuildForWeek();
        this.syncWeekBar();
        this.searchBar.setState({
          titleQuery: getTitle(this.boardQuery),
          selectedTags: getTags(this.boardQuery),
          excludedTags: getExcludedTags(this.boardQuery),
        });
        this.sortBar.setState(getSort(this.boardQuery));
        this.groupBar.setState(getGroup(this.boardQuery));
        this.persistState();
        this.applyQuery();
      },
    ).open();
  }

  /**
   * This board's colour rules, with the shared ones from plugin settings
   * appended **below** them.
   *
   * {@link colorFor} takes the first matching rule, so order is priority:
   * appending puts a board's own rule ahead of a shared one, letting a board
   * override the shared palette while still inheriting everything it does not
   * mention. The base board appends nothing — its own rules *are* the shared
   * ones, so merging would only duplicate them.
   */
  private buildColorRules(): ColorRule[] {
    const shared = this.persistence.getBaseCardColors();
    const lines = [this.forWeek(this.cardColors), shared].filter(
      (value) => value.trim() !== "",
    );
    return parseColorRules(lines.join("\n")).rules;
  }

  /**
   * The Monday of the week this board is showing, or null when it is not a week
   * board — which is also the one test for "does any of this apply".
   */
  private weekMonday(): Date | null {
    if (this.boardType !== "week") {
      return null;
    }
    return addWeeks(startOfWeek(new Date()), this.weekOffset);
  }

  /**
   * Substitute the shown week's values into a templated field, or hand it back
   * untouched on any other kind of board.
   *
   * Only fields the board stores as *text* go through here — filters,
   * mutations, colour rules. The query is not one of them: the bars edit it as
   * structure and write it back, so a placeholder put there would be parsed
   * away the first time someone typed in the search box. A week board scopes
   * itself by its columns instead, which is what makes that unnecessary.
   */
  private forWeek(text: string): string {
    const monday = this.weekMonday();
    return monday ? renderWeek(text, monday) : text;
  }

  /**
   * Rebuild everything that is rendered *for a week*: the card actions and the
   * colour rules. Called wherever their raw text changes, and whenever the week
   * does — the two are the same event as far as the board is concerned.
   */
  private rebuildForWeek(): void {
    this.actions = buildBoardActions(
      this.actionConfigs.map((action) => ({
        ...action,
        mutation: this.forWeek(action.mutation),
      })),
    );
    this.colorRules = this.buildColorRules();
  }

  /**
   * Go back to the week we are in, for a board that has just been handed a
   * different note (Obsidian reuses a leaf, and with it this component): the
   * week you had paged to belonged to the board that left.
   */
  resetWeek(): void {
    this.showWeek(0);
  }

  /** Page the board `delta` weeks and re-render. */
  private stepWeek(delta: number): void {
    this.showWeek(this.weekOffset + delta);
  }

  /**
   * Show the week `offset` weeks from this one. Nothing is persisted: which
   * week you are looking at is not part of the board (see {@link weekOffset}).
   */
  private showWeek(offset: number): void {
    if (offset === this.weekOffset) {
      return;
    }
    this.weekOffset = offset;
    this.rebuildForWeek();
    this.syncWeekBar();
    this.applyQuery();
  }

  /** Point the navigator at the week now being shown, or hide it. */
  private syncWeekBar(): void {
    this.weekBar.setWeek(this.weekMonday(), this.weekOffset === 0);
  }

  /**
   * Persist the slice of state that survives reopens: the canonical query string
   * and the set of folded columns.
   */
  private persistState() {
    void this.persistence.save({
      query: serializeQuery(this.boardQuery),
      boardType: this.boardType,
      collapsedColumns: [...this.collapsedColumns],
      collapsedGroups: [...this.collapsedGroups],
      columns: this.columnConfigs,
      metaColumns: this.metaColumns,
      actions: this.actionConfigs,
      columnTagPrefix: this.columnTagPrefix,
      columnOrder: this.columnOrder,
      dateField: this.dateField,
      dateColumns: this.dateColumns,
      noDateColumn: this.noDateColumn,
      cardColors: this.cardColors,
    });
  }

  /**
   * Fold/unfold a column across every lane and persist. The collapsed set is
   * keyed by column id, so the change applies to that column in all lanes.
   */
  private toggleColumn(columnId: string, collapsed: boolean) {
    if (collapsed) {
      this.collapsedColumns.add(columnId);
    } else {
      this.collapsedColumns.delete(columnId);
    }
    // Apply to the same column in every other lane so folding is board-wide.
    for (const lane of this.lanes) {
      lane.setColumnCollapsed(columnId, collapsed);
    }
    this.persistState();
  }

  /** Fold/unfold a swimlane (by group key) and persist. */
  private toggleGroup(groupKey: string, collapsed: boolean) {
    if (collapsed) {
      this.collapsedGroups.add(groupKey);
    } else {
      this.collapsedGroups.delete(groupKey);
    }
    this.persistState();
  }

  /**
   * Render the board with current tasks
   */
  render() {
    this.updateTasks(this.rawTasks);
  }

  /**
   * Update tasks and redistribute across columns.
   *
   * Nesting is resolved here, before anything else looks at the list: a nested
   * task is not a board citizen at all — it gets no card, its tags never reach
   * the tag filter or the tag columns, and queries never match it. It only ever
   * appears inside its root task's card. Everything downstream therefore sees
   * root tasks alone.
   */
  updateTasks(tasks: Task[]) {
    this.rawTasks = tasks;
    const deduped = this.removeDuplicateTasks(tasks);
    const { roots, subTasksOf } = nestTasks(deduped);
    this.allTasks = roots;
    this.subTasksOf = subTasksOf;
    this.searchBar.setTags(getUniqueTags(this.allTasks));
    this.applyQuery();
  }

  /**
   * Remove duplicate tasks based on ID
   */
  private removeDuplicateTasks(tasks: Task[]): Task[] {
    const seenIds = new Set<string>();
    return tasks.filter((task) => {
      const id = task.id || task.originalMarkdown;
      if (seenIds.has(id)) {
        return false;
      }
      seenIds.add(id);
      return true;
    });
  }

  /**
   * Reload the query from persistence and re-apply it.
   */
  reloadQueryFromPersistence(): void {
    const state = this.persistence.get();
    this.boardQuery = parseQuery(state.query).query;
    this.baseQuery = parseQuery(this.persistence.getBaseQuery()).query;
    this.collapsedColumns = new Set(state.collapsedColumns);
    this.collapsedGroups = new Set(state.collapsedGroups);
    this.boardType = state.boardType;
    this.columnConfigs = state.columns;
    this.metaColumns = state.metaColumns;
    this.actionConfigs = state.actions;
    this.columnTagPrefix = state.columnTagPrefix;
    this.columnOrder = state.columnOrder;
    this.dateField = state.dateField;
    this.dateColumns = state.dateColumns;
    this.noDateColumn = state.noDateColumn;
    this.cardColors = state.cardColors;
    this.rebuildForWeek();
    this.syncWeekBar();
    this.searchBar.setState({
      titleQuery: getTitle(this.boardQuery),
      selectedTags: getTags(this.boardQuery),
      excludedTags: getExcludedTags(this.boardQuery),
    });
    this.sortBar.setState(getSort(this.boardQuery));
    this.groupBar.setState(getGroup(this.boardQuery));
    this.applyQuery();
  }

  /**
   * Apply the canonical query (filter + sort), split into swimlanes by the group
   * slice, and render. Grouping runs after filter+sort, mirroring Tasks.
   */
  private applyQuery() {
    const merged = mergeQueries(this.baseQuery, this.boardQuery);
    const ordered = applyBoardQuery(this.allTasks, merged);
    const groups = groupTasks(ordered, merged.group);
    // When grouping is active the board is a vertical stack of content-sized
    // lanes; when off it is a single lane that fills the height (today's layout).
    this.boardEl.toggleClass(
      "tasks-kanban-board-grouped",
      merged.group.field !== "none",
    );
    this.renderLanes(groups);
  }

  /**
   * The columns to render: this board's meta columns, then the columns its
   * declared type produces (chosen by that type rather than by which optional
   * field happens to be filled in).
   *
   * Meta columns come first because a task goes to the first column that
   * collects it (see KanbanLane.updateTasks): a meta column may overlap the
   * type's columns — the weekly planner's "Unplanned" pool overlaps "No date" —
   * and leading means it wins that overlap.
   *
   * Tag columns are discovered from every task the board holds — not from the
   * filtered ones — so a column doesn't vanish the moment a filter empties it.
   * A tag board with no prefix yet has nothing to discover columns from, so it
   * falls back to status columns until one is configured.
   */
  private resolveColumnConfigs(): KanbanColumnConfig[] {
    const metaColumns = this.metaColumns.map((column) => ({
      ...column,
      filter: this.forWeek(column.filter),
      mutation: this.forWeek(column.mutation),
    }));
    return [...buildMetaColumns(metaColumns), ...this.typeColumnConfigs()];
  }

  /** The columns of the board's own type, without the meta columns. */
  private typeColumnConfigs(): KanbanColumnConfig[] {
    const monday = this.weekMonday();
    if (monday) {
      // Built for the week being shown, never read from the file: this is what
      // one note being every week's board comes down to.
      return buildDateColumns(
        this.dateField,
        weekColumns(monday),
        this.noDateColumn,
      );
    }
    if (this.boardType === "date") {
      return buildDateColumns(
        this.dateField,
        this.dateColumns,
        this.noDateColumn,
      );
    }
    if (this.boardType === "tag" && this.columnTagPrefix !== "") {
      return buildTagColumns(
        this.allTasks,
        this.columnTagPrefix,
        parseColumnOrder(this.columnOrder, this.columnTagPrefix),
      );
    }
    return resolveColumns(
      this.columnConfigs,
      this.tasksIntegration.getStatuses(),
    );
  }

  /**
   * Reconcile the rendered lanes with the given groups. We rebuild the lanes
   * when either the ordered group keys or the resolved column set change;
   * otherwise we keep the lanes and just refresh their tasks (lanes are cheap and
   * these structural changes are infrequent). The column set is folded into the
   * lane signature so editing columns (which doesn't change group keys) still
   * re-renders — hence the signature carries every field a column matches on.
   */
  private renderLanes(groups: TaskGroup[]) {
    const columnConfigs = this.resolveColumnConfigs();
    const columnSignature = columnConfigs
      .map(
        (c) =>
          `${c.id}:${c.title}:${c.symbols.join("")}:${c.tag ?? ""}:${c.date ?? ""}:${
            c.filters ? JSON.stringify(c.filters) : ""
          }`,
      )
      .join("|");
    const keys = groups.map((g) => `${columnSignature}#${g.key}`);
    const sameLanes =
      keys.length === this.laneKeys.length &&
      keys.every((key, i) => key === this.laneKeys[i]);

    if (!sameLanes) {
      for (const lane of this.lanes) {
        lane.destroy();
      }
      this.lanes = [];
      for (const group of groups) {
        this.lanes.push(
          new KanbanLane(
            this.boardEl,
            group.key,
            group.label,
            columnConfigs,
            this.tasksIntegration,
            this.collapsedColumns,
            this.collapsedGroups.has(group.key),
            (columnId, collapsed) => this.toggleColumn(columnId, collapsed),
            (groupKey, collapsed) => this.toggleGroup(groupKey, collapsed),
          ),
        );
      }
      this.laneKeys = keys;
    }

    groups.forEach((group, i) =>
      this.lanes[i].updateTasks(
        group.tasks,
        this.colorRules,
        this.subTasksOf,
        this.actions,
      ),
    );
  }

  /**
   * Clean up the board
   */
  destroy() {
    this.searchBar.destroy();
    this.sortBar.destroy();
    this.groupBar.destroy();
    this.weekBar.destroy();
    for (const lane of this.lanes) {
      lane.destroy();
    }
    this.lanes = [];
    this.laneKeys = [];
  }
}
