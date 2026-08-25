import type { BoardActionConfig } from "../types/persistence";
import { parseMutation, type MutationInstruction } from "./taskMutation";

/** The label a nameless action falls back to in the menu. */
export const UNNAMED_ACTION_TITLE = "Action";

/** One menu item at render time: a label and the mutation it runs. */
export interface BoardAction {
  id: string;
  title: string;
  mutation: MutationInstruction[];
}

/**
 * Build a board's card-menu actions from their configuration.
 *
 * An action whose mutation holds no usable instruction is dropped — a menu item
 * that does nothing is worse than one that is missing, since the user cannot
 * tell it apart from one that failed. The board settings flag it first.
 */
export function buildBoardActions(actions: BoardActionConfig[]): BoardAction[] {
  const built: BoardAction[] = [];

  for (const action of actions) {
    const { mutations } = parseMutation(action.mutation);
    if (mutations.length === 0) {
      continue;
    }
    built.push({
      id: action.id,
      title: action.title.trim() || UNNAMED_ACTION_TITLE,
      mutation: mutations,
    });
  }

  return built;
}

/**
 * Every error in a board's actions, for the settings modal — same shape as the
 * meta-column errors, prefixed with the action so a board with several says
 * which one is broken.
 */
export function boardActionErrors(actions: BoardActionConfig[]): string[] {
  const errors: string[] = [];

  actions.forEach((action, index) => {
    const label = action.title.trim() || `Action ${index + 1}`;
    const { mutations, errors: parseErrors } = parseMutation(action.mutation);
    for (const error of parseErrors) {
      errors.push(`${label}: ${error}`);
    }
    if (parseErrors.length === 0 && mutations.length === 0) {
      errors.push(`${label}: needs at least one instruction.`);
    }
  });

  return errors;
}
