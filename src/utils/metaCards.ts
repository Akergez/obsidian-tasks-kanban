import { parseFilterLines, type FilterInstruction } from "../query/boardQuery";
import { renderTemplate } from "../query/template";
import type { MetaCardConfig } from "../types/persistence";
import type { KanbanColumnConfig } from "./statusColumns";

/**
 * The placeholders a meta card's filter may name on top of a week board's own:
 * the ones that come from the column it is rendered for.
 */
export const META_CARD_VARIABLES = ["day"];

/**
 * What a column contributes to a meta card's filter. Only a column standing for
 * one day has anything to give; the "No date" catch-all and every status or tag
 * column give nothing, so a rule naming `{{day}}` is left unrendered there.
 */
function columnVariables(column: KanbanColumnConfig): Record<string, string> {
  return column.date ? { day: column.date } : {};
}

/**
 * The meta card filters that apply to `column`: each rule rendered for that
 * column and parsed, one filter list per rule. A task shows in the column as a
 * meta card when it satisfies any of them.
 *
 * A rule is skipped where it cannot be rendered — it names a placeholder the
 * column has no value for — and wherever its filter is empty or broken: an
 * empty filter would match every task, which is a misconfiguration rather than
 * a wildcard, and the board settings flag both before they can be saved.
 */
export function metaCardFiltersFor(
  configs: MetaCardConfig[],
  column: KanbanColumnConfig,
): FilterInstruction[][] {
  const variables = columnVariables(column);
  const built: FilterInstruction[][] = [];

  for (const config of configs) {
    const rendered = renderTemplate(config.filter, variables);
    if (rendered.errors.length > 0) {
      continue;
    }
    const { filters, errors } = parseFilterLines(rendered.text);
    if (filters.length === 0 || errors.length > 0) {
      continue;
    }
    built.push(filters);
  }

  return built;
}

/**
 * Every error in the board's meta card rules, for the settings modal, in the
 * shape the meta column errors use. Parsed unrendered: a placeholder reads as
 * an ordinary value until a column fills it in.
 */
export function metaCardErrors(configs: MetaCardConfig[]): string[] {
  const errors: string[] = [];

  configs.forEach((config, index) => {
    const label = config.title.trim() || `Meta card ${index + 1}`;
    const filter = parseFilterLines(config.filter);
    for (const error of filter.errors) {
      errors.push(`${label}: ${error}`);
    }
    if (filter.errors.length === 0 && filter.filters.length === 0) {
      errors.push(`${label}: needs at least one filter line.`);
    }
  });

  return errors;
}
