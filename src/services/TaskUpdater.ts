import { type App, TFile } from "obsidian";
import type { Task } from "./TasksIntegration";
import type { TasksIntegration } from "./TasksIntegration";
import { FIELD_SYNTAX, resolveTaskFormat } from "../utils/taskFormat";

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

      const line = lines[lineNumber];
      const match = line.match(/^(\s*- \[)[^\]]*(]\s*.*)$/);
      if (!match) {
        return false;
      }

      // Get Tasks plugin write settings
      const { setDoneDate, setCancelledDate, taskFormat } =
        await this.tasksIntegration.getWriteSettings();
      const syntax = FIELD_SYNTAX[resolveTaskFormat(taskFormat)];

      // Get current and new status types
      const currentStatus = this.tasksIntegration.getStatusBySymbol(
        task.status.symbol,
      );
      const newStatus =
        this.tasksIntegration.getStatusBySymbol(newStatusSymbol);

      // First, replace the status symbol in the line
      const lineWithNewSymbol = line.replace(
        `${match[1]}${task.status.symbol}${match[2]}`,
        `${match[1]}${newStatusSymbol}${match[2]}`,
      );

      // Build the updated line
      let updatedLine = lineWithNewSymbol;

      // Handle done date: add when transitioning TO DONE, remove when transitioning AWAY from DONE
      if (newStatus?.type === "DONE" && currentStatus?.type !== "DONE") {
        if (setDoneDate) {
          const today = this.getTodayDateString();
          // No $ anchor: see FieldSyntax.strip doc comment in taskFormat.ts.
          updatedLine = updatedLine.replace(syntax.doneDate.strip, "");
          updatedLine = `${updatedLine}${syntax.doneDate.render(today)}`;
        }
      } else if (currentStatus?.type === "DONE" && newStatus?.type !== "DONE") {
        // Transitioning AWAY from DONE - remove the done date
        updatedLine = updatedLine.replace(syntax.doneDate.strip, "");
      }

      // Handle cancelled date: add when transitioning TO CANCELLED, remove when transitioning AWAY from CANCELLED
      if (
        newStatus?.type === "CANCELLED" &&
        currentStatus?.type !== "CANCELLED"
      ) {
        if (setCancelledDate) {
          const today = this.getTodayDateString();
          updatedLine = updatedLine.replace(syntax.cancelledDate.strip, "");
          updatedLine = `${updatedLine}${syntax.cancelledDate.render(today)}`;
        }
      } else if (
        currentStatus?.type === "CANCELLED" &&
        newStatus?.type !== "CANCELLED"
      ) {
        // Transitioning AWAY from CANCELLED - remove the cancelled date
        updatedLine = updatedLine.replace(syntax.cancelledDate.strip, "");
      }

      lines[lineNumber] = updatedLine;

      await this.app.vault.modify(file, lines.join("\n"));
      return true;
    } catch (error) {
      console.error("Failed to update task status:", error);
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
