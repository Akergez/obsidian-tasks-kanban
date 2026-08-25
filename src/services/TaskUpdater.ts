import { type App, TFile } from "obsidian";
import type { Task } from "./TasksIntegration";
import type { TasksIntegration } from "./TasksIntegration";
import {
  resolveTaskFormat,
  setDateField,
  type WritableDateField,
} from "../utils/taskFormat";
import { setColumnTag } from "../utils/tagColumns";
import {
  applyMutations,
  applyStatusChange,
  type MutationContext,
  type MutationInstruction,
} from "../utils/taskMutation";

/**
 * Service for updating task status in source files
 */
export class TaskUpdater {
  private app: App;
  private tasksIntegration: TasksIntegration;

  constructor(app: App, tasksIntegration: TasksIntegration) {
    this.app = app;
    this.tasksIntegration = tasksIntegration;
  }

  /**
   * Update the status of a task in its source file
   * Replaces the status symbol in the task line
   * Also adds done/cancelled date if transitioning to DONE/CANCELLED and settings are enabled
   */
  async updateTaskStatus(
    task: Task,
    newStatusSymbol: string,
  ): Promise<boolean> {
    return this.rewriteTaskLine(task, async (line) =>
      applyStatusChange(
        line,
        task.status.symbol,
        newStatusSymbol,
        await this.mutationContext(),
      ),
    );
  }

  /**
   * Apply a meta column's mutation to a task: rewrite its line so every
   * instruction of the mutation holds (see utils/taskMutation). One rewrite for
   * the whole mutation, so a column that changes both the status and a date
   * writes the file once.
   */
  async applyMutation(
    task: Task,
    mutations: MutationInstruction[],
  ): Promise<boolean> {
    if (mutations.length === 0) {
      return false;
    }
    return this.rewriteTaskLine(task, async (line) =>
      applyMutations(line, task, mutations, await this.mutationContext()),
    );
  }

  /**
   * Move a task between tag columns: rewrite its line so it carries exactly the
   * column tag `#<tagPrefix>_<tag>`, or none when `tag` is "" (the catch-all
   * column). The status symbol is left untouched — under tag columns the board
   * no longer owns it.
   */
  async updateTaskColumnTag(
    task: Task,
    tagPrefix: string,
    tag: string,
  ): Promise<boolean> {
    return this.rewriteTaskLine(task, (line) =>
      setColumnTag(line, tagPrefix, tag),
    );
  }

  /**
   * Move a task between the columns of a date board: rewrite its line so its
   * `field` date is `date`, or carries no such date when `date` is null (the
   * catch-all column). The status symbol is left untouched — under date columns
   * the board no longer owns it.
   */
  async updateTaskDate(
    task: Task,
    field: WritableDateField,
    date: string | null,
  ): Promise<boolean> {
    return this.rewriteTaskLine(task, async (line) => {
      const { taskFormat } = await this.tasksIntegration.getWriteSettings();
      return setDateField(line, field, date, resolveTaskFormat(taskFormat));
    });
  }

  /**
   * The vault's statuses and the Tasks plugin's write settings, read fresh for
   * each write so a settings change applies to the next one.
   */
  private async mutationContext(): Promise<MutationContext> {
    const { setDoneDate, setCancelledDate, taskFormat } =
      await this.tasksIntegration.getWriteSettings();
    return {
      statusOf: (symbol) => this.tasksIntegration.getStatusBySymbol(symbol),
      // Looked up lazily, and only by `set done` / `set not done`: the first
      // configured status of the type, which is how a status column picks its
      // drop symbol too (core statuses come before custom ones).
      symbolForType: (type) =>
        this.tasksIntegration.getStatuses().find((s) => s.type === type)
          ?.symbol ?? null,
      format: resolveTaskFormat(taskFormat),
      setDoneDate,
      setCancelledDate,
      today: this.getTodayDateString(),
    };
  }

  /**
   * Read the task's source line, hand it to `transform`, and write the result
   * back. Returns false — without touching the file — when the task has no
   * usable location, the file is missing, the line is out of range, or
   * `transform` returns null (it could not make sense of the line).
   */
  private async rewriteTaskLine(
    task: Task,
    transform: (line: string) => string | null | Promise<string | null>,
  ): Promise<boolean> {
    const filePath = task.taskLocation?.path;
    const lineNumber = task.taskLocation?.lineNumber;
    if (!filePath || lineNumber === undefined) {
      return false;
    }

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) {
      return false;
    }

    try {
      const content = await this.app.vault.read(file);
      const lines = content.split("\n");

      if (lineNumber < 0 || lineNumber >= lines.length) {
        return false;
      }

      const updatedLine = await transform(lines[lineNumber]);
      if (updatedLine === null) {
        return false;
      }

      lines[lineNumber] = updatedLine;

      await this.app.vault.modify(file, lines.join("\n"));
      return true;
    } catch (error) {
      console.error("Failed to update task line:", error);
      return false;
    }
  }

  /**
   * Get today's date as a formatted string (YYYY-MM-DD)
   * Uses window.moment if available, otherwise falls back to standard Date
   */
  private getTodayDateString(): string {
    if (typeof window !== "undefined" && window.moment) {
      return window.moment().format("YYYY-MM-DD");
    }
    // Fallback for testing or environments without moment
    const today = new Date();
    return today.toISOString().split("T")[0];
  }
}
