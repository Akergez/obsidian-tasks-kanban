import { describe, it, expect, vi } from "vitest";
import {
  patchLeafViewMode,
  type LeafLike,
  type ViewStateLike,
} from "../src/services/leafViewMode";

/** A stand-in for WorkspaceLeaf.prototype, recording what it was asked to open. */
function proto() {
  const calls: ViewStateLike[] = [];
  const target: LeafLike = {
    setViewState(state: ViewStateLike) {
      calls.push(state);
      return Promise.resolve();
    },
  };
  return { target, calls };
}

/** Patch `target` with the given boards and text-preferred notes. */
function patch(
  target: LeafLike,
  boards: string[],
  text: string[] = [],
  onOpenedAsBoard = vi.fn(),
) {
  return {
    unpatch: patchLeafViewMode({
      proto: target,
      markdownViewType: "markdown",
      boardViewType: "tasks-board",
      shouldOpenAsBoard: (path) => boards.includes(path),
      isTextPreferred: (path) => text.includes(path),
      onOpenedAsBoard,
    }),
    onOpenedAsBoard,
  };
}

describe("patchLeafViewMode", () => {
  it("opens a board note in the board view instead of the editor", () => {
    const { target, calls } = proto();
    patch(target, ["Kanban/Sprint.md"]);

    void target.setViewState({
      type: "markdown",
      state: { file: "Kanban/Sprint.md", mode: "source" },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe("tasks-board");
    // Everything else about the state is carried through untouched.
    expect(calls[0].state).toEqual({
      file: "Kanban/Sprint.md",
      mode: "source",
    });
  });

  it("leaves an ordinary note in the editor", () => {
    const { target, calls } = proto();
    patch(target, ["Kanban/Sprint.md"]);

    void target.setViewState({
      type: "markdown",
      state: { file: "Notes/Diary.md" },
    });

    expect(calls[0].type).toBe("markdown");
  });

  it("leaves a note the user asked to edit as text", () => {
    // Otherwise "Edit text" would bounce straight back to the board.
    const { target, calls } = proto();
    patch(target, ["Kanban/Sprint.md"], ["Kanban/Sprint.md"]);

    void target.setViewState({
      type: "markdown",
      state: { file: "Kanban/Sprint.md" },
    });

    expect(calls[0].type).toBe("markdown");
  });

  it("says when it swapped, so the plugin can record the mode", () => {
    const { target } = proto();
    const { onOpenedAsBoard } = patch(target, ["Kanban/Sprint.md"]);

    void target.setViewState({
      type: "markdown",
      state: { file: "Kanban/Sprint.md" },
    });

    expect(onOpenedAsBoard).toHaveBeenCalledWith("Kanban/Sprint.md");
  });

  it("ignores states that are not a markdown file", () => {
    const { target, calls } = proto();
    patch(target, ["Kanban/Sprint.md"]);

    void target.setViewState({ type: "empty", state: {} });
    void target.setViewState({ type: "markdown", state: {} });
    void target.setViewState({ type: "graph" });

    expect(calls.map((call) => call.type)).toEqual([
      "empty",
      "markdown",
      "graph",
    ]);
  });

  it("passes the rest of the arguments through", () => {
    const seen: unknown[][] = [];
    const target: LeafLike = {
      setViewState(...args: unknown[]) {
        seen.push(args);
        return Promise.resolve();
      },
    };
    patch(target, ["Kanban/Sprint.md"]);

    void target.setViewState(
      { type: "markdown", state: { file: "Kanban/Sprint.md" } },
      { focus: true },
    );

    expect(seen[0][1]).toEqual({ focus: true });
  });

  it("puts the original back", () => {
    const { target, calls } = proto();
    const original = target.setViewState;
    const { unpatch } = patch(target, ["Kanban/Sprint.md"]);
    unpatch();

    expect(target.setViewState).toBe(original);
    void target.setViewState({
      type: "markdown",
      state: { file: "Kanban/Sprint.md" },
    });
    expect(calls[0].type).toBe("markdown");
  });
});
