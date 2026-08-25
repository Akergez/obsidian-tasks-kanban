# AGENTS.md - Obsidian Tasks Kanban Plugin

## About the Project

**Name**: Obsidian Tasks Kanban
**Description**: Kanban board view plugin for Obsidian that displays Tasks in a visual board layout with drag & drop support.

## Development Rules

### Code Style

- **Language**: TypeScript
- **Framework**: Obsidian Plugin API
- **Build Tool**: esbuild
- **Package Manager**: npm (pnpm preferred if available)
- **Test Framework**: vitest

### Workflow

- Always ship tests with your code
- Always run `npm run format` before finishing to format your changes with Prettier
- Always run linters, the typecheck, tests and build scripts to validate your work
- Use Test Driven Development (TDD) until asked otherwise
- Prefer minimal, focused changes
- Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/) (enforced by commitlint)

### Git Hooks

Husky runs checks automatically (installed via the `prepare` script on `npm install`):

- **pre-commit**: `lint-staged` (ESLint `--fix` + Prettier on staged files) then `npm run typecheck`
- **commit-msg**: `commitlint` validates the message against Conventional Commits

### Build Process

```bash
npm install          # Install dependencies
npm run build        # Production build (minified)
npm run dev          # Development build with watch
npm test             # Run unit tests
npm run typecheck    # Type-check with tsc (no emit)
npm run format      # Format code with Prettier
```

## Project Structure

```
obsidian-tasks-kanban/
├── .github/workflows/ci.yml         # GitHub Actions CI
├── src/
│   ├── main.ts                      # Plugin entry point, commands, persistence
│   ├── services/
│   │   ├── TasksIntegration.ts      # Integration with Tasks plugin + statuses
│   │   ├── BoardRepository.ts       # Read/write the vault's .kanban board files
│   │   └── TaskUpdater.ts           # Update task status in source files
│   ├── views/
│   │   └── TasksBoardView.ts        # Kanban view (a TextFileView over a .kanban file)
│   ├── components/
│   │   ├── KanbanBoard.ts           # Board logic (query, grouping, columns)
│   │   ├── KanbanLane.ts            # Swimlane (one per group)
│   │   ├── KanbanColumn.ts          # Column component (drop zone)
│   │   ├── KanbanCard.ts            # Task card component (draggable)
│   │   ├── SearchBar.ts             # Title + tag filter bar
│   │   ├── SortBar.ts               # Sort control
│   │   ├── GroupBar.ts              # Grouping control
│   │   ├── QueryModal.ts            # Raw query editor
│   │   ├── BoardSettingsModal.ts    # One board's own settings, opened on the board
│   │   └── BoardPickerModal.ts      # Saved-board picker
│   ├── query/
│   │   ├── boardQuery.ts            # Query parse/serialize/apply (filters+sort+group)
│   │   └── boardFile.ts             # .kanban YAML board format (serialize/parse)
│   ├── utils/
│   │   ├── statusColumns.ts         # Default + custom column resolution
│   │   ├── tagColumns.ts            # Tag-derived columns + tag rewriting
│   │   ├── dateColumns.ts           # Day columns for a date board
│   │   ├── weeklyBoard.ts           # ISO weeks + the weekly planner's board
│   │   ├── metaColumns.ts           # Meta columns: predicate + mutation columns
│   │   ├── boardActions.ts          # Card-menu actions: named mutations
│   │   ├── booleanFilter.ts         # (a) AND/OR/XOR (b), NOT (a) over filters
│   │   ├── taskMutation.ts          # The mutation language + applying it to a line
│   │   ├── columnMatch.ts           # columnCollects: the one column↔task matcher
│   │   ├── taskFormat.ts            # Emoji/Dataview date field syntax + writing
│   │   ├── groupTasks.ts            # Swimlane grouping
│   │   ├── sortTasks.ts             # Sorting
│   │   ├── searchFilter.ts          # Tag/title helpers
│   │   └── taskChips.ts             # Card metadata chips
│   ├── settings/
│   │   └── SettingsTab.ts           # Only what is shared across every board
│   └── types/
│       └── persistence.ts           # Persisted data model
├── styles.css                      # Board styles
├── manifest.json                   # Plugin manifest
├── package.json                    # Dependencies and scripts
└── AGENTS.md                       # Development guidelines
```

## Architecture Notes

### Board Storage

A board is a `.kanban` file in the vault, holding YAML (see `query/boardFile.ts` for the format, which is hand-serialized so multi-line fields come out as block scalars, and parsed via Obsidian's `parseYaml`). `main.ts` calls `registerExtensions` so clicking the file opens the board.

`TasksBoardView` is a **TextFileView**: Obsidian owns reading/writing the bytes, and the view holds the parsed board in memory, exposing it to `KanbanBoard` through the existing synchronous `BoardStatePersistence`. Nothing below the view knows about files. Opened with no file, the same view shows the base board, whose settings stay in `data.json`.

`services/BoardRepository.ts` lists, reads, writes and deletes board files for the settings pane and the picker — the boards that aren't open. Boards that used to live in `data.json` are migrated to files once, on load.

### Tasks Integration

The plugin integrates with the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin via Obsidian's event system:

- **Events**: Listens to `obsidian-tasks-plugin:cache-update` for real-time task updates
- **Data Flow**: Tasks → Events → TasksIntegration → KanbanBoard → Columns → Cards
- **Status Update**: Uses TaskUpdater to modify task status in source files

### Drag & Drop

- **Implementation**: Native HTML5 Drag & Drop API
- **Data Transfer**: Uses custom data types (`application/task-id`, `application/task-path`)
- **Visual Feedback**: CSS classes for dragging/drop states
- **Status Update**: On drop, updates task status in source file → Tasks detects change → auto-refresh

### Where Settings Live

Split by scope, and the split is load-bearing:

- **Plugin settings** (`settings/SettingsTab.ts`) hold only what is shared across every board: task format, base query, base card colours, the two folders. It never lists boards — boards are files and a vault accumulates them (the weekly planner adds one a week), so a pane that listed them would scroll without end.
- **A board's own settings** (`components/BoardSettingsModal.ts`) are opened from a gear button in the board header. The modal edits a `BoardSettingsDraft` copy and hands the whole thing back on Save, so Cancel really cancels and one Save is one write.

`SettingsTab.getSettingDefinitions()` returns `[]` **on purpose**: Obsidian 1.13 skips `display()` whenever it returns anything, and filling it in is how the per-board settings once went missing entirely.

### Merging Shared Settings Into a Board

Two shared values reach every board through `BoardStatePersistence`:

- `getBaseQuery()` → `mergeQueries(base, own)`.
- `getBaseCardColors()` → `KanbanBoard.buildColorRules()` concatenates **own rules first, shared below**. `colorFor` takes the first match, so order is priority: a board overrides a shared colour and inherits the rest.

The base board returns `""` from `getBaseCardColors()` — its own rules *are* the shared ones, so merging would only duplicate them.

### Board Types and Columns

A board's `boardType` (`status` | `tag` | `date`, in `types/persistence.ts`) is an **explicit** setting, never inferred from which other field happens to be filled in. `KanbanBoard.resolveColumnConfigs` switches on it:

- **Status columns** (`utils/statusColumns.ts`) — the default. One column per status type, or a user-defined partition over status symbols. A drop writes the column's `dropSymbol`.
- **Tag columns** (`utils/tagColumns.ts`) — columns are discovered from the tasks' `#<prefix>_<column>` tags: those named in the board's `columnOrder` come first in that order, the rest follow alphabetically, and a catch-all for untagged tasks leads. A drop rewrites the tag via `TaskUpdater.updateTaskColumnTag` and leaves the status alone. With no prefix set yet there is nothing to discover from, so the board falls back to status columns.
- **Date columns** (`utils/dateColumns.ts`) — one column per configured exact day (`YYYY-MM-DD`) on one `dateField`, led by a "No date" catch-all unless the board's `noDateColumn` turns it off (it defaults on, so a board written before the flag keeps every column it had). Unlike tag columns these are *configured, not discovered*, which is what makes a task dated outside every column **hidden**. A drop writes that day via `TaskUpdater.updateTaskDate` (the catch-all clears the field) and leaves the status alone.

On top of its type's columns a board may carry any number of **meta columns** (`utils/metaColumns.ts`, configured per board in the settings modal):

- A meta column is a *predicate* — filter lines in the board query language — plus a *mutation* — instructions in its imperative twin (`utils/taskMutation.ts`), applied by `TaskUpdater.applyMutation` when a card is dropped in. Neither is tied to one field, which is the point: the column is defined by what it means.
- The predicate can say things a single field cannot, which is why the query language grew boolean combinators (`utils/booleanFilter.ts`): `(no scheduled date) OR (scheduled before today)`. Operators are capitals and every sub-filter is parenthesised, as in the Tasks reference; that is also what keeps a lowercase "or" inside a description filter ordinary text.
- Meta columns render **before** the type's columns, and a task goes to the **first** column that collects it (`KanbanLane.updateTasks`). Overlap is therefore resolved by position: the planner's "Unplanned" pool overlaps the date board's "No date" catch-all and wins it. Before meta columns existed no two columns could overlap, so first-match changes nothing for the older types.

A board also carries **card actions** (`utils/boardActions.ts`): named mutations, in the same language, offered by `KanbanCard` in an Obsidian `Menu` on right-click and applied through the same `TaskUpdater.applyMutation`. Dropping a card and picking a command are the same act with different triggers, which is why they share a language; what differs is that a column mutates what is dropped into it and an action mutates what is asked. They ride to the cards alongside the colour rules (`KanbanLane.updateTasks` → `KanbanColumn.updateTasks` → `KanbanCard`), so a settings change reaches them on the next render. A board with no actions does not touch the contextmenu event.

`columnCollects` (in `utils/columnMatch.ts`) is the single matcher for all four modes; `KanbanLane` and `KanbanColumn`'s drop handler go through it, so distribution and drops can't disagree.

`resolveBoardType` handles boards written before types were explicit: no `boardType` key means the old implicit rule applies (a `columnTagPrefix` ⇒ tag board, otherwise status).

### Weekly Planner

The ribbon's calendar button calls `TasksKanbanPlugin.openWeeklyPlanner`. `utils/weeklyBoard.ts` is pure: `startOfWeek` (Monday-based, unlike the Sunday-based `in this week` query filter, which follows Tasks), `isoWeekName` (`2026-W35`, decided by the week's Thursday) and `buildWeeklyBoard`, whose column ids are derived from the day so the document is a pure function of the week.

The planner is a date board with no "No date" catch-all — its columns are the seven weekdays, led by the `Unplanned` meta column, which already holds the undated work worth seeing: unfinished tasks with no day, or with a day **older than this week's Monday**, minus anything carrying another week's preplanning tag. The threshold is the week's start, not today — a planner filtered on `before today` would empty its own earlier days as the week ran on: unfinished work with no day, or a day already past. Its mutation (`set not done`, `clear <field> date`) is the exact undoing of a drop into a weekday, so dragging a card out of the week returns it to the pool rather than leaving it dated in the past. Both are written against the planner's own date field.

`weekTag` builds a week's **preplanning tag** (`#w35_2026`, ISO week and week-year, unpadded). A task carrying one is assigned to that week without a day; the pool's third filter line — `(tag regex matches /^#w0*35_2026$/) OR NOT (tag regex matches /^#w\d+_\d{4}$/)` — keeps other weeks' work out. It is written in the query language rather than in matching code, so it is visible in the board file and editable there; `tag regex matches` was added to the language for it.

`weeklyActions` puts three commands on every card's menu: **Next week** (clear the day, drop this week's tag, add next week's — so the card leaves this board for the next week's planner), **Cancel** (`set status.type CANCELLED`) and **Done** (`set done`).

The week name is the file name, so identity is positional, not stored: `BoardRepository.ensure` writes the file only when it is absent, which is what makes reopening mid-week return the board with its edits rather than a regenerated one. The folder comes from `weeklyPlannerFolder`, nested under `boardsFolder` by default so weekly boards still appear in the picker.

### Writing Dates

`utils/taskFormat.ts` owns the syntax of every Tasks date field in both formats, and `setDateField` is the one writer: it strips existing occurrences **written in the active format only** (a foreign-format token is the user's own text) and appends the new one before any trailing `^block-id`.

Which format is active comes from `TasksIntegration.getWriteSettings()`: the Tasks plugin's own `taskFormat`, overridden by this plugin's `taskFormat` setting unless that is `auto`.

Status changes go through `applyStatusChange` (`utils/taskMutation.ts`), which is also what `set done` / `set not done` reach: the done/cancelled-date rule lives there once, so a status-column drop and a meta column's mutation cannot drift apart. `TaskUpdater` supplies the surrounding facts (statuses, write settings, today) as a `MutationContext`, keeping the rewriting itself pure.

### Nested Tasks

`utils/taskHierarchy.ts` splits the cache's flat task list into root tasks and their descendants, reading nesting from each line's indentation (`originalMarkdown`) and line number — the cache exposes no parent/child fields we trust. `KanbanBoard.updateTasks` runs this **before** anything else touches the list, so filtering, sorting, tag columns, and the tag dropdown all see roots only; sub-tasks reach the UI solely as `KanbanCard`'s `subTasks`.

## Testing

### Unit Tests

Tests use Vitest with JSDom environment. Test files are in the `tests/` directory.

```bash
npm test        # Run all tests once
npm run test:watch  # Watch mode for development
```

### Manual Testing

1. Open Obsidian with Test vault
2. Enable Tasks and Tasks Kanban plugins
3. Create tasks with different statuses
4. Open Kanban board via command palette
5. Test drag & drop between columns
6. Verify status updates in source files

## Gotchas

- **Task ID Format**: Tasks plugin uses `^task-id` format for task identification
- **Status Symbols**: Tasks uses single character symbols for status (space, x, /, -, etc.)
- **File Access**: Use `app.vault.read()` and `app.vault.write()` for file operations
- **Event Timing**: Tasks may emit multiple cache-update events on startup
- **Duplicate Tasks**: Always deduplicate tasks by ID before processing
