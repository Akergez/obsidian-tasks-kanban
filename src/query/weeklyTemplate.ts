import { renderTemplate } from "./template";
import { weekVariables } from "../utils/weeklyBoard";

/**
 * The weekly planner as a template note.
 *
 * The planner used to be built in code; it is a document now, so the structure
 * of a week — which columns, which pool, which card actions — belongs to
 * whoever edits this file. The plugin only substitutes the week's values (see
 * {@link weekVariables}) and writes the result as that week's note.
 *
 * Written out verbatim rather than serialized from a BoardFile: the comments
 * and the blank lines are half of what makes it editable.
 */
export const DEFAULT_WEEKLY_TEMPLATE = `---
tasks-kanban: true
---

# {{year}}-W{{ww}}

\`\`\`tasks-kanban
name: {{year}}-W{{ww}}
boardType: date
dateField: scheduled
noDateColumn: false

query: |-
  sort by priority

metaColumns:
  - id: meta:unplanned
    title: Unplanned
    filter: |-
      not done
      (no scheduled date) OR (scheduled before {{monday}})
      (tag regex matches /^#w0*{{week}}_{{year}}$/) OR NOT (tag regex matches /^#w\\d+_\\d{4}$/)
    mutation: |-
      set not done
      clear scheduled date

actions:
  - id: action:next-week
    title: Next week
    mutation: |-
      clear scheduled date
      remove tag #w{{week}}_{{year}}
      add tag #w{{nextWeek}}_{{nextYear}}
  - id: action:cancel
    title: Cancel
    mutation: |-
      set status.type CANCELLED
  - id: action:done
    title: Done
    mutation: |-
      set done

dateColumns:
  - id: date:{{monday}}
    title: Monday
    date: "{{monday}}"
  - id: date:{{tuesday}}
    title: Tuesday
    date: "{{tuesday}}"
  - id: date:{{wednesday}}
    title: Wednesday
    date: "{{wednesday}}"
  - id: date:{{thursday}}
    title: Thursday
    date: "{{thursday}}"
  - id: date:{{friday}}
    title: Friday
    date: "{{friday}}"
  - id: date:{{saturday}}
    title: Saturday
    date: "{{saturday}}"
  - id: date:{{sunday}}
    title: Sunday
    date: "{{sunday}}"
\`\`\`
`;

/**
 * Render a weekly template for the week starting at `monday`.
 *
 * Errors name the placeholders the template asked for and this plugin does not
 * know; the text still comes back, with those placeholders left standing, so
 * the note that gets written shows plainly where the typo is.
 */
export function renderWeeklyTemplate(
  template: string,
  monday: Date,
): { text: string; errors: string[] } {
  return renderTemplate(template, weekVariables(monday));
}
