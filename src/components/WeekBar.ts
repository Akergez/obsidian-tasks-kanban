import { setIcon } from "obsidian";

import { isoWeekName, weekRange } from "../utils/weeklyBoard";

/** What the bar reports when one of its controls is used. */
export interface WeekBarHandlers {
  /** Page the board `delta` weeks (−1 back, +1 forward). */
  step(delta: number): void;
  /** Return to the week we are actually in. */
  today(): void;
}

/**
 * The week navigator: `‹ 2026-W35 ›`, shown only on a week board.
 *
 * A week board fixes no week, so which week it shows is not in the file and not
 * in this bar either — the bar reports a step and is told, through
 * {@link setWeek}, what to say afterwards. That keeps the week in one place (the
 * board) rather than in two that must agree.
 *
 * The label is a button because the way back from "three weeks ahead" should be
 * one click, not three.
 */
export class WeekBar {
  private readonly root: HTMLElement;
  private readonly label: HTMLButtonElement;

  constructor(container: HTMLElement, handlers: WeekBarHandlers) {
    this.root = container.createDiv({ cls: "tasks-kanban-week" });

    const previous = this.button("chevron-left", "Previous week");
    previous.addEventListener("click", () => handlers.step(-1));

    this.label = this.root.createEl("button", {
      cls: "tasks-kanban-week-label",
      attr: { type: "button" },
    });
    this.label.addEventListener("click", () => handlers.today());

    const next = this.button("chevron-right", "Next week");
    next.addEventListener("click", () => handlers.step(1));
  }

  /**
   * Show `monday`'s week, or hide the bar entirely when there is none — this is
   * the whole of "only week boards get arrows". `current` marks the week we are
   * actually in, so paging away is visible at a glance.
   */
  setWeek(monday: Date | null, current = false): void {
    if (!monday) {
      this.root.hide();
      return;
    }
    this.root.show();
    this.label.setText(isoWeekName(monday));
    this.label.setAttribute("aria-label", `${weekRange(monday)} — this week`);
    this.label.setAttribute("title", weekRange(monday));
    this.label.toggleClass("tasks-kanban-week-current", current);
  }

  destroy(): void {
    this.root.remove();
  }

  /** One of the two arrows. */
  private button(icon: string, label: string): HTMLButtonElement {
    const button = this.root.createEl("button", {
      cls: "tasks-kanban-week-step",
      attr: { type: "button", "aria-label": label, title: label },
    });
    setIcon(button, icon);
    return button;
  }
}
