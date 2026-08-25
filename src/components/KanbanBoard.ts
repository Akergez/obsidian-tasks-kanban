import { setIcon, type App } from "obsidian";

import type { Task } from "../services/TasksIntegration";
import { TasksIntegration } from "../services/TasksIntegration";
import { KanbanLane } from "./KanbanLane";
import { SearchBar } from "./SearchBar";
import { SortBar } from "./SortBar";
import { GroupBar } from "./GroupBar";
import { QueryModal } from "./QueryModal";
import {
  BoardSettingsModal,
  type BoardSettingsDraft,
} from "./BoardSettingsModal";
import { resolveColumns } from "../utils/statusColumns";
import type { KanbanColumnConfig } from "../utils/statusColumns";
import { buildTagColumns, parseColumnOrder } from "../utils/tagColumns";
import { buildDateColumns } from "../utils/dateColumns";
import { buildMetaColumns } from "../utils/metaColumns";
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
  /** Custom columns for this board; empty ⇒ default status columns. */
  private columnConfigs: ColumnConfig[];
  /** Meta columns for this board, rendered before the type's columns. */
  private metaColumns: MetaColumnConfig[];
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

  constructor(
    container: HTMLElement,
    app: App,
    tasksIntegration: TasksIntegration,
    persistence: BoardStatePersistence,
  ) {
    this.container = container;
    this.app = app;
    this.tasksIntegration = tasksIntegration;
    this.persistence = persistence;

    // Hydrate the canonical query from the persisted query string.
    const initial = persistence.get();
    this.boardQuery = parseQuery(initial.query).query;
    this.baseQuery = parseQuery(persistence.getBaseQuery()).query;
    this.collapsedColumns = new Set(initial.collapsedColumns);
    this.collapsedGroups = new Set(initial.collapsedGroups);
    this.boardType = initial.boardType;
    this.columnConfigs = initial.columns;
    this.metaColumns = initial.metaColumns;
    this.columnTagPrefix = initial.columnTagPrefix;
    this.columnOrder = initial.columnOrder;
    this.dateField = initial.dateField;
    this.dateColumns = initial.dateColumns;
    this.noDateColumn = initial.noDateColumn;
    this.cardColors = initial.cardColors;
    this.colorRules = this.buildColorRules();

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

    this.createQueryButton(header);
    this.createSettingsButton(header);

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
        this.cardColors = next.cardColors;
        this.colorRules = this.buildColorRules();
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
    const lines = [this.cardColors, shared].filter(
      (value) => value.trim() !== "",
    );
    return parseColorRules(lines.join("\n")).rules;
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
    this.columnTagPrefix = state.columnTagPrefix;
    this.columnOrder = state.columnOrder;
    this.dateField = state.dateField;
    this.dateColumns = state.dateColumns;
    this.noDateColumn = state.noDateColumn;
    this.cardColors = state.cardColors;
    this.colorRules = this.buildColorRules();
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
    return [...buildMetaColumns(this.metaColumns), ...this.typeColumnConfigs()];
  }

  /** The columns of the board's own type, without the meta columns. */
  private typeColumnConfigs(): KanbanColumnConfig[] {
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
      this.lanes[i].updateTasks(group.tasks, this.colorRules, this.subTasksOf),
    );
  }

  /**
   * Clean up the board
   */
  destroy() {
    this.searchBar.destroy();
    this.sortBar.destroy();
    this.groupBar.destroy();
    for (const lane of this.lanes) {
      lane.destroy();
    }
    this.lanes = [];
    this.laneKeys = [];
  }
}
