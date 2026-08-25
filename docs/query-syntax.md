# Query Syntax

The Tasks Kanban board supports a subset of the [Tasks](https://publish.obsidian.md/tasks) query syntax for filtering, sorting, and grouping tasks on the board.

## Supported Instructions

Each instruction should be on its own line. Blank lines are ignored.

### Filtering

| Instruction | Description | Example |
|-------------|-------------|---------|
| `tag includes #<tag>` | Show tasks with the specified tag | `tag includes #work` |
| `description includes <text>` | Show tasks whose description contains the text (case-insensitive) | `description includes write tests` |
| `done` | Show tasks whose status type is `DONE`, `CANCELLED` or `NON_TASK` | `done` |
| `not done` | Show tasks whose status type is `TODO`, `IN_PROGRESS` or `ON_HOLD` | `not done` |
| `status.type (is\|is not) <TYPE>` | Filter by status type | `status.type is not NON_TASK` |
| `status.name (includes\|does not include) <text>` | Case-insensitive substring match on the status name | `status.name includes progress` |
| `status.name (regex matches\|regex does not match) /<pattern>/` | Regex match on the status name (case-sensitive unless the `i` flag is given) | `status.name regex matches /^In/i` |
| `path (includes\|does not include) <text>` | Case-insensitive substring of the full path from the vault root | `path includes Work/` |
| `filename (includes\|does not include) <text>` | Case-insensitive substring of the file name | `filename includes Alpha` |
| `folder (includes\|does not include) <text>` | Case-insensitive substring of the containing folder | `folder includes Projects` |
| `<path\|filename\|folder> (regex matches\|regex does not match) /<pattern>/` | Regex match (case-sensitive unless the `i` flag is given) | `path regex matches /^Work/i` |
| `<date field> (before\|after\|on) <day>` | Compare a date field against a day | `scheduled before today` |
| `<date field> in <period>` | The date falls in a period | `due in this week` |
| `(has\|no) <date field> date` | The task has, or has not, a date in that field | `no scheduled date` |
| `(<filter>) (AND\|OR\|XOR) (<filter>)` | Combine filters; every sub-filter is parenthesised and the operator is capitalised | `(no due date) OR (due before today)` |
| `NOT (<filter>)` | Negate a filter | `NOT (tag includes #someday)` |

#### Date Fields and Days

Date fields are `due`, `scheduled`, `start`, `created`, `done`, `cancelled` (the plural spellings Tasks accepts — `starts`, `dues` — work too). A day is `YYYY-MM-DD` or `today` / `tomorrow` / `yesterday`; a period is `this|next|last week`, `this|next|last month`, or `this year`.

#### Combining Filters

The operators must be capitals, and each sub-filter must be in its own parentheses — the same shape the Tasks reference uses, and what keeps a lowercase "or" inside `description includes cats or dogs` ordinary text. `NOT` binds tightest, then `AND`, then `XOR`, then `OR`; parenthesise to say otherwise.


#### File Location Fields

`path` is the whole path from the vault root and `filename` is the file name — **both keep the `.md` extension**, as they do in Tasks. `folder` is the containing directory, which is `/` for a note at the vault root.

#### Status Types

`TODO`, `DONE`, `IN_PROGRESS`, `ON_HOLD`, `CANCELLED`, `NON_TASK` — matched case-insensitively, so `status.type is in_progress` works too.

Note that `done` covers cancelled tasks as well, matching the Tasks reference; `not done` is its exact complement. To hide finished work from a board, add `not done` to its query (or to the base query, to apply it everywhere).

### Sorting

| Instruction | Description | Example |
|-------------|-------------|---------|
| `sort by <field>` | Sort tasks by the specified field in ascending order | `sort by due` |
| `sort by <field> reverse` | Sort tasks by the specified field in descending order | `sort by due reverse` |

#### Supported Sort Fields

- `due` - Due date
- `scheduled` - Scheduled date
- `start` - Start date
- `created` - Creation date
- `priority` - Priority
- `filename` - Name of the note the task lives in (alphabetical, case-insensitive)

### Grouping

Grouping splits the board into horizontal swimlanes — one lane per distinct value of the chosen field. Lanes are foldable.

| Instruction | Description | Example |
|-------------|-------------|---------|
| `group by <field>` | Group tasks into swimlanes by the specified field | `group by priority` |
| `group by <field> reverse` | Group, reversing the lane order | `group by status reverse` |

#### Supported Group Fields

- `status` - Status name
- `priority` - Priority
- `tags` - Tags (a multi-tag task appears in each of its tag lanes)
- `path` - Full file path
- `folder` - Containing folder
- `filename` - File name (without `.md`)

Date-based grouping (`due`, `scheduled`, etc.) is intentionally not supported: one lane per distinct date scatters the board.

## Examples

### Filter by tag
```
tag includes #work
```

### Filter by multiple tags (OR logic)
```
tag includes #work
tag includes #personal
```

### Filter by description
```
description includes write documentation
```

### Combine filters
```
tag includes #project
description includes urgent
```

### Sort tasks
```
sort by due
```

### Sort in reverse order
```
sort by priority reverse
```

### Group into swimlanes
```
group by priority
```

### Everything unfinished that is not planned ahead
```
not done
(no scheduled date) OR (scheduled before today)
```

### Complete example
```
tag includes #work
tag includes #important
description includes write tests
sort by due reverse
group by priority
```

## Notes

- Tag values should include the `#` prefix (e.g., `#work`, not `work`)
- Description matching is case-insensitive
- Multiple `tag includes` instructions are OR-ed together (a task matches if it has any of the tags)
- Multiple `description includes` instructions are AND-ed together (a task must match all descriptions)
- Sort instructions are applied after filtering; grouping is applied last
- Only the last `sort by` / `group by` instruction is used if multiple are provided

## Meta Columns

A board's columns normally come from one field — a status, a column tag, a day. A **meta column** is defined by what it means instead: a *filter*, in the language above, and a *mutation* saying what a card dropped into it becomes. Both are edited in the board's settings (the gear button on the board), and any board type can carry them.

A card is shown in the first column that collects it, and meta columns come first — so a meta column wins over any column it overlaps. The weekly planner ships with one, the `Unplanned` pool:

```
# filter
not done
(no scheduled date) OR (scheduled before today)
```
```
# mutation
set not done
clear scheduled date
```

Dropping a card into a weekday schedules it for that day; dropping it back into `Unplanned` undoes exactly that — the task stops being done and loses its day.

### Mutation Instructions

Each instruction is the imperative form of the filter it makes true. One per line, applied in order.

| Instruction | Effect | Example |
|-------------|--------|---------|
| `set done` | Give the task the vault's first `DONE` status (and its done date) | `set done` |
| `set not done` | Give it the vault's first `TODO` status, dropping the done date | `set not done` |
| `set status <symbol>` | Write an exact status symbol; `[ ]` spells the space one | `set status /` |
| `set <date field> <day>` | Write that day into the field | `set scheduled today` |
| `clear <date field> date` | Remove that date | `clear due date` |
| `add tag #<tag>` | Add the tag if the task does not carry it | `add tag #next` |
| `remove tag #<tag>` | Remove the tag | `remove tag #waiting` |

Date fields and days are spelled as in the filter language. A meta column with no mutation still collects — it is then a read-only pool, and dropping into it does nothing.

## Unsupported Tasks Query Syntax

The following Tasks query instructions are **not** supported and will be reported as errors:

- `priority is <value>` (use `sort by priority` for sorting)
- `recurring` / `not recurring`
- `status.symbol` filters (Tasks has no built-in one either)
- `group by <date field>` (e.g. `group by due`) — date grouping scatters the board; only `status`, `priority`, `tags`, `path`, `folder`, `filename` are supported
- `group by function` (arbitrary JavaScript)
- `limit`
- Any other Tasks query instruction

For full Tasks query syntax, see the [Tasks documentation](https://publish.obsidian.md/tasks/Queries).
