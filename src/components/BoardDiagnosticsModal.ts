import { App, Modal, Notice } from "obsidian";

/**
 * The diagnostics report, shown where it can be read and copied.
 *
 * Not the console: the plugin guidelines rule that out, and a report you have
 * to go looking for in devtools is a report that does not get sent. This is one
 * button away from the clipboard.
 */
export class BoardDiagnosticsModal extends Modal {
  private readonly report: string;

  constructor(app: App, report: string) {
    super(app);
    this.report = report;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("tasks-kanban-diagnostics-modal");
    contentEl.createEl("h3", { text: "Board diagnostics" });
    contentEl.createEl("p", {
      text: "What the plugin sees for the note in front of you. Copy this when reporting that a board did not open.",
    });

    const body = contentEl.createEl("pre", {
      cls: "tasks-kanban-diagnostics-report",
    });
    body.setText(this.report);

    const buttons = contentEl.createDiv({
      cls: "tasks-kanban-query-modal-buttons",
    });
    const copy = buttons.createEl("button", {
      cls: "mod-cta",
      text: "Copy",
      attr: { type: "button" },
    });
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(this.report).then(() => {
        new Notice("Tasks kanban: diagnostics copied.");
      });
    });

    const close = buttons.createEl("button", {
      text: "Close",
      attr: { type: "button" },
    });
    close.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
