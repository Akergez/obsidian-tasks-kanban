/**
 * Opening a board as a board, the way plugins that store their documents in
 * `.md` do it (Kanban, Excalidraw): by intercepting `setViewState` on the leaf
 * and changing the view type **before** the view is built.
 *
 * Reacting to `file-open` instead does not work, and this is the bug it caused:
 * the swap happens in the middle of Obsidian's own open, Obsidian finishes what
 * it was doing, and the note ends up in the markdown editor anyway. There is
 * nothing to react to — the decision has to be made on the way in.
 *
 * Written against a minimal shape rather than Obsidian's classes so the rule is
 * testable without Obsidian.
 */

/** The bit of Obsidian's ViewState this rule looks at. */
export interface ViewStateLike {
  type: string;
  state?: { file?: unknown } & Record<string, unknown>;
}

/** The bit of WorkspaceLeaf this rule touches. */
export interface LeafLike {
  id?: string;
  // Called on a leaf, so `this` is the leaf; the patch below relies on that.
  setViewState: (
    this: LeafLike,
    state: ViewStateLike,
    ...rest: unknown[]
  ) => unknown;
}

export interface ViewModePatch {
  /** The prototype to patch — `WorkspaceLeaf.prototype` in Obsidian. */
  proto: LeafLike;
  /** Obsidian's own view type for a note. */
  markdownViewType: string;
  /** The view type a board should open in instead. */
  boardViewType: string;
  /** Whether this note should open as a board right now. */
  shouldOpenAsBoard(path: string): boolean;
  /** Called when the type was swapped, so the caller can record the mode. */
  onOpenedAsBoard(path: string): void;
  /**
   * Whether the user asked for this note's *text* — "Edit text" — in which case
   * the swap must not happen, or the button would bounce straight back.
   */
  isTextPreferred(path: string): boolean;
}

/**
 * Patch `setViewState` so a board note opens in the board view. Returns the
 * function that puts the original back; call it when the plugin unloads.
 */
export function patchLeafViewMode(patch: ViewModePatch): () => void {
  const { proto } = patch;
  const original = proto.setViewState;

  proto.setViewState = function (
    this: LeafLike,
    state: ViewStateLike,
    ...rest: unknown[]
  ) {
    const path = state?.state?.file;

    if (
      state?.type === patch.markdownViewType &&
      typeof path === "string" &&
      !patch.isTextPreferred(path) &&
      patch.shouldOpenAsBoard(path)
    ) {
      patch.onOpenedAsBoard(path);
      return original.call(
        this,
        { ...state, type: patch.boardViewType },
        ...rest,
      );
    }

    return original.call(this, state, ...rest);
  };

  return () => {
    proto.setViewState = original;
  };
}
