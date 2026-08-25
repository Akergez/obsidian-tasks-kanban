import type { Task } from "../services/TasksIntegration";
import { TasksIntegration } from "../services/TasksIntegration";
import { truncate } from "../utils/truncate";
import {
  getDateChips,
  getDependencyChips,
  getPriorityChip,
  stripTags,
  type Chip,
} from "../utils/taskChips";
import { taskFileName } from "../utils/taskFile";
import { taskHeadings } from "../utils/taskHeadings";
import type { SubTask } from "../utils/taskHierarchy";
import { Menu, setTooltip } from "obsidian";
import type { App } from "obsidian";
import type { BoardAction } from "../utils/boardActions";

/**
 * Status types that count as finished for the sub-task counter, matching the
 * `done` query filter (see utils/statusFilter).
 */
const DONE_TYPES = new Set(["DONE", "CANCELLED", "NON_TASK"]);

/**
 * The Kanban card component - represents a single task
 */
export class KanbanCard {
  private container: HTMLElement;
  private task: Task;
  private tasksIntegration: TasksIntegration;
  private app: App;
  private dragStartHandler: ((e: DragEvent) => void) | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private contextMenuHandler: ((e: MouseEvent) => void) | null = null;
  /** Spine colour from the board's colour rules, or undefined for the default. */
  private readonly spineColor?: string;
  /** Tasks nested under this one in the source file, in document order. */
  private readonly subTasks: SubTask[];
  /** The board's card-menu actions, offered on right-click. */
  private readonly actions: BoardAction[];

  constructor(
    container: HTMLElement,
    task: Task,
    tasksIntegration: TasksIntegration,
    spineColor?: string,
    subTasks: SubTask[] = [],
    actions: BoardAction[] = [],
  ) {
    this.container = container;
    this.task = task;
    this.tasksIntegration = tasksIntegration;
    this.app = tasksIntegration.app;
    this.spineColor = spineColor;
    this.subTasks = subTasks;
    this.actions = actions;
  }

  /**
   * Render the card
   */
  render() {
    this.container.empty();
    this.container.addClass("tasks-kanban-card");
    this.container.setAttribute("data-task-id", this.task.id);
    this.container.setAttribute(
      "data-task-path",
      this.task.taskLocation?.path || "",
    );
    this.container.setAttribute("draggable", "true");

    // Paint the spine when a board colour rule matches this task. Everything
    // else about the spine (width, default colour) lives in the stylesheet.
    if (this.spineColor) {
      this.container.addClass("tasks-kanban-card-spined");
      this.container.style.setProperty(
        "--tasks-kanban-card-spine",
        this.spineColor,
      );
    }

    // Title: the task text, with its tags stripped (they get their own row).
    const fullTitle = stripTags(this.task.description, this.task.tags);
    const titleEl = this.container.createDiv({
      cls: "tasks-kanban-card-title",
    });
    const displayText = truncate(fullTitle);
    titleEl.setText(displayText);
    if (displayText !== fullTitle) {
      titleEl.setAttribute("title", fullTitle);
    }

    // Nested tasks, listed inside this card rather than getting cards of their own
    this.renderSubTasks();

    // Metadata chips (priority, dates, dependencies)
    this.renderChips();

    // Footer: tags alongside the name of the note the task lives in.
    this.renderFooter();

    // Add drag start handler
    this.setupDragAndDrop();

    // Add click handler to open the source file
    this.clickHandler = (event: MouseEvent) => {
      event.stopPropagation();
      this.openSourceFile();
    };
    this.container.addEventListener("click", this.clickHandler);

    this.contextMenuHandler = (event: MouseEvent) => {
      if (this.actions.length === 0) {
        // Nothing configured: leave the event alone so Obsidian's own menu,
        // and the platform's, still behave as they would on any other card.
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.showActionMenu(event);
    };
    this.container.addEventListener("contextmenu", this.contextMenuHandler);
  }

  /**
   * The card's right-click menu: one item per board action, each running that
   * action's mutation against this task. The board owns which actions exist —
   * the card only knows how to offer them.
   */
  private showActionMenu(event: MouseEvent): void {
    const menu = new Menu();
    for (const action of this.actions) {
      menu.addItem((item) =>
        item.setTitle(action.title).onClick(() => {
          void this.tasksIntegration.taskUpdater.applyMutation(
            this.task,
            action.mutation,
          );
        }),
      );
    }
    menu.showAtMouseEvent(event);
  }

  /**
   * Render the metadata chips row (priority, dates, dependencies). The row is
   * only created when there is at least one chip, so cards without metadata
   * don't gain an empty gap.
   */
  private renderChips() {
    const chips: Chip[] = [];

    const priority = getPriorityChip(this.task.priority);
    if (priority) {
      chips.push(priority);
    }

    chips.push(...getDateChips(this.task));

    const deps = getDependencyChips(
      this.task,
      this.tasksIntegration.getTasks(),
    );
    if (deps.blocked) chips.push(deps.blocked);
    if (deps.dependsOn) chips.push(deps.dependsOn);
    if (deps.id) chips.push(deps.id);

    if (chips.length === 0) {
      return;
    }

    const chipsEl = this.container.createDiv({
      cls: "tasks-kanban-card-chips",
    });
    for (const chip of chips) {
      const chipEl = chipsEl.createSpan({
        cls: [
          "tasks-kanban-card-chip",
          `tasks-kanban-card-chip-${chip.modifier}`,
        ],
        text: `${chip.emoji} ${chip.label}`,
      });
      if (chip.title) {
        setTooltip(chipEl, chip.title);
      }
    }
  }

  /**
   * Render the nested tasks as a checklist inside the card.
   *
   * Sub-task tags are deliberately not shown: a nested task is not a board
   * citizen (it has no card, and its tags reach neither the tag filter nor the
   * tag columns), so surfacing them here would suggest an influence they don't
   * have. Their text is stripped of tags for the same reason.
   *
   * Completion is shown by striking the line through rather than by bringing
   * back a status icon — the counter in the heading carries the summary.
   */
  private renderSubTasks() {
    if (this.subTasks.length === 0) {
      return;
    }

    const doneCount = this.subTasks.filter((sub) =>
      DONE_TYPES.has(sub.task.status.type),
    ).length;

    const listEl = this.container.createDiv({
      cls: "tasks-kanban-card-subtasks",
    });
    listEl.createDiv({
      cls: "tasks-kanban-card-subtasks-count",
      text: `${doneCount}/${this.subTasks.length}`,
    });

    for (const sub of this.subTasks) {
      const isDone = DONE_TYPES.has(sub.task.status.type);
      const itemEl = listEl.createDiv({
        cls: isDone
          ? "tasks-kanban-card-subtask tasks-kanban-card-subtask-done"
          : "tasks-kanban-card-subtask",
        text: stripTags(sub.task.description, sub.task.tags),
      });
      // Deeper nesting steps in; depth 1 sits flush with the list.
      if (sub.depth > 1) {
        itemEl.style.setProperty(
          "--tasks-kanban-subtask-indent",
          `${(sub.depth - 1) * 12}px`,
        );
      }
    }
  }

  /**
   * Render the footer row: the task's tags, then where it lives — its note and
   * the headings it sits under. The row is skipped entirely when there is
   * neither: a task with no tags in a location-less cache entry shouldn't gain
   * an empty gap.
   */
  private renderFooter() {
    const tags = this.task.tags ?? [];
    const trail = this.locationTrail();
    if (tags.length === 0 && trail.length === 0) {
      return;
    }

    const footerEl = this.container.createDiv({
      cls: "tasks-kanban-card-footer",
    });

    if (tags.length > 0) {
      const tagsEl = footerEl.createDiv({ cls: "tasks-kanban-card-tags" });
      for (const tag of tags) {
        tagsEl.createSpan({ cls: "tasks-kanban-card-tag", text: tag });
      }
    }

    if (trail.length > 0) {
      this.renderLocation(footerEl, trail);
    }
  }

  /**
   * Where the task lives, **nearest first**: the heading it sits directly
   * under, then each heading around that, and the note last.
   *
   * The order is the point. `Todo › Sprint 3 › Projects` leads with the section
   * that actually places the task, and the reader can stop as soon as they know
   * enough; the note's name is the widest container and the least it says, so it
   * comes last. The headings are what turn "somewhere in Projects" into
   * something locatable at all — on a board gathering tasks from a whole vault,
   * a note's name alone often names a container far too big to place anything
   * in.
   */
  private locationTrail(): string[] {
    const fileName = taskFileName(this.task);
    const headings = taskHeadings(this.app, this.task);
    if (fileName === "") {
      return [...headings].reverse();
    }

    // A note titled with an `# H1` repeating its own file name is a common
    // habit, and "Todo › Projects › Projects" says nothing the note's name did
    // not. The heading dropped is the outermost one — the file name always
    // stays, since it is there whether or not the note has headings at all.
    const outermost = headings[0]?.toLowerCase();
    const inside =
      outermost === fileName.toLowerCase() ? headings.slice(1) : headings;
    return [...inside].reverse().concat(fileName);
  }

  /**
   * The location, drawn in full: every segment, separated by a chevron, wrapping
   * onto as many lines as it takes.
   *
   * Nothing is shortened and nothing is dropped — the styling keeps it faint and
   * small, and the card grows instead. A trail that had to be read from a
   * tooltip would not be worth showing.
   */
  private renderLocation(footerEl: HTMLElement, trail: string[]): void {
    const locationEl = footerEl.createDiv({
      cls: "tasks-kanban-card-file",
    });

    trail.forEach((segment, index) => {
      if (index > 0) {
        locationEl.createSpan({
          cls: "tasks-kanban-card-file-separator",
          text: "›",
        });
      }
      locationEl.createSpan({
        cls: "tasks-kanban-card-file-part",
        text: segment,
      });
    });

    // The path is the one part of the location the trail does not say, since it
    // names the note and not the folders above it.
    setTooltip(locationEl, this.task.taskLocation?.path ?? trail.join(" › "));
  }

  /**
   * Set up drag and drop for the card
   */
  private setupDragAndDrop() {
    this.dragStartHandler = (e: DragEvent) => {
      if (!e.dataTransfer) return;

      e.dataTransfer.setData("text/plain", this.task.description);
      e.dataTransfer.setData(
        "application/task-path",
        this.task.taskLocation?.path || "",
      );
      e.dataTransfer.setData(
        "application/task-line",
        String(this.task.taskLocation?.lineNumber ?? -1),
      );

      // Set the drag image (optional visual feedback)
      if (e.target) {
        e.dataTransfer.setDragImage(e.target as HTMLElement, 0, 0);
      }

      // Add visual feedback
      this.container.addClass("tasks-kanban-card-dragging");

      // Required for Firefox
      e.dataTransfer.effectAllowed = "move";
    };

    this.container.addEventListener("dragstart", this.dragStartHandler);

    // Clean up on drag end
    this.container.addEventListener("dragend", () => {
      this.container.removeClass("tasks-kanban-card-dragging");
    });
  }

  /**
   * Open the source file where this task is located
   */
  private openSourceFile() {
    const filePath = this.task.taskLocation?.path;
    if (filePath && this.app) {
      const file = this.app.vault.getFileByPath(filePath);
      if (file) {
        void this.app.workspace.getLeaf().openFile(file);
      }
    }
  }

  /**
   * Clean up the card
   */
  destroy() {
    if (this.dragStartHandler) {
      this.container.removeEventListener("dragstart", this.dragStartHandler);
      this.dragStartHandler = null;
    }

    this.container.removeEventListener("dragend", () => {});

    if (this.contextMenuHandler) {
      this.container.removeEventListener(
        "contextmenu",
        this.contextMenuHandler,
      );
      this.contextMenuHandler = null;
    }

    if (this.clickHandler) {
      this.container.removeEventListener("click", this.clickHandler);
      this.clickHandler = null;
    }

    this.container.remove();
  }

  /**
   * Get the task associated with this card
   */
  getTask(): Task {
    return this.task;
  }
}
