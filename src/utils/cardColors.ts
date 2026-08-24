import type { Task } from "../services/TasksIntegration";
import {
  parseFilterLine,
  taskMatchesFilters,
  type FilterInstruction,
} from "../query/boardQuery";

/**
 * One card-spine colouring rule: a filter line paired with the colour to paint
 * the spine of every card the filter matches.
 */
export interface ColorRule {
  /** The parsed filter, using the board query language. */
  filter: FilterInstruction;
  /** The CSS colour written to the spine, verbatim from the setting. */
  color: string;
}

/** Separator between a rule's filter and its colour. */
const ARROW = "->";

/**
 * Colours we refuse, because they would let a rule reach outside the spine.
 * Everything else is handed to CSS as-is: named colours, hex, rgb()/hsl(), and
 * `var(--…)` all work, and an unparseable value simply paints nothing.
 */
const UNSAFE_COLOR = /[;{}()]/;

/** Allow the one function-shaped colour form worth supporting: var(--name). */
const CSS_VARIABLE = /^var\(\s*--[\w-]+\s*\)$/;

/**
 * Parse the board's card-colour setting: one `<filter> -> <colour>` rule per
 * line, blank lines ignored. Rules keep their written order — {@link colorFor}
 * takes the first match, so the most specific rule belongs at the top.
 *
 * Parsing is tolerant in the same way {@link parseQuery} is: a bad line is
 * skipped and reported in `errors` (with its 1-based line number) so the
 * settings pane can show feedback without discarding the other rules.
 */
export function parseColorRules(input: string): {
  rules: ColorRule[];
  errors: string[];
} {
  const rules: ColorRule[] = [];
  const errors: string[] = [];

  input.split("\n").forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === "") {
      return;
    }

    const arrow = line.lastIndexOf(ARROW);
    if (arrow === -1) {
      errors.push(
        `Line ${index + 1}: expected "<filter> ${ARROW} <colour>", e.g. tag includes #urgent ${ARROW} red`,
      );
      return;
    }

    const color = line.slice(arrow + ARROW.length).trim();
    if (color === "") {
      errors.push(`Line ${index + 1}: missing colour after "${ARROW}"`);
      return;
    }
    if (UNSAFE_COLOR.test(color) && !CSS_VARIABLE.test(color)) {
      errors.push(`Line ${index + 1}: unsupported colour "${color}"`);
      return;
    }

    const filterText = line.slice(0, arrow).trim();
    if (filterText === "") {
      errors.push(`Line ${index + 1}: missing filter before "${ARROW}"`);
      return;
    }

    const parsed = parseFilterLine(filterText);
    if ("error" in parsed) {
      errors.push(`Line ${index + 1}: ${parsed.error}`);
      return;
    }

    rules.push({ filter: parsed.filter, color });
  });

  return { rules, errors };
}

/**
 * The spine colour for a task: the colour of the first rule whose filter it
 * matches, or undefined when no rule does (the card then keeps the default
 * spine from the stylesheet).
 */
export function colorFor(task: Task, rules: ColorRule[]): string | undefined {
  for (const rule of rules) {
    if (taskMatchesFilters(task, [rule.filter])) {
      return rule.color;
    }
  }
  return undefined;
}
