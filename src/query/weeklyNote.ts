/**
 * The weekly planner as a note.
 *
 * One note is the planner for **every** week: nothing here names a week, and
 * the `{{…}}` placeholders are left standing in the file. A week board renders
 * them for whichever week you are looking at (see utils/weeklyBoard), so paging
 * forward is a re-render, not a new file — there is nothing to create, nothing
 * to keep in step, and last month's planner is the same document as this
 * week's.
 *
 * Written out verbatim rather than serialized from a BoardFile: the comments
 * and the blank lines are half of what makes it editable, and this text is only
 * a starting point — once the note exists it belongs to whoever edits it.
 */
export const DEFAULT_WEEKLY_NOTE = `---
tasks-kanban: true
---

# Weekly planner

One board for every week: the columns are the days of the week you are looking
at, and the arrows above them page back and forth. \`{{week}}\`, \`{{year}}\` and
\`{{monday}}\` below stand for whichever week that is.

\`\`\`tasks-kanban
name: Weekly
boardType: week
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
\`\`\`
`;
