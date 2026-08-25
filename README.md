# Obsidian Tasks Kanban

A Kanban board view plugin for Obsidian that displays Tasks in a visual board layout.

> **How does this plugin compare to other Kanban ones?** See [Comparison](#comparison).

## Features

- **Kanban Board View**: Display your tasks in a Kanban-style board with a column per status
- **Four Board Types**: Pick per board whether its columns are statuses, tags, dates, or the days of a week
- **Weekly Planner**: One ribbon click opens a planner with a column per weekday — one note that is the board for *every* week, with arrows to page between them
- **Boards Are Files**: Each board is a readable `.kanban` YAML file in your vault — click it to open, and it syncs and versions like any note
- **Base Query**: A shared query merged into every board, so common filters live in one place
- **Per-Board Settings**: Each board is configured on the board itself, from a gear button — settings never turn into an endless list
- **Custom Columns**: Optionally replace the default status columns with your own, mapping each column to specific status symbols (e.g. split "In Progress" into "Ongoing" `/` and "In Review" `A`)
- **Grouping (Swimlanes)**: Group cards into foldable lanes by status, priority, tags, path, folder, or filename
- **Sorting**: Sort cards by priority or a date field, ascending or descending
- **Filtering**: Search bar for title and tags, plus full Tasks-style query editing
- **Drag & Drop**: Move tasks between columns to change their status
- **Tasks Integration**: Listens to Tasks plugin events for real-time updates
- **Task Format Aware**: Writes dates in whichever format Tasks' own **Task Format** setting specifies — emoji (`✅ 2026-08-04`) or Dataview (`[completion:: 2026-08-04]`) — and lets you pin one in Settings
- **Card Design**: The task text reads as the card's title, with tags and the task's location — every heading above it, nearest first, then the note — in the footer
- **Nested Tasks**: Indented sub-tasks are listed inside the parent's card instead of getting cards of their own
- **Card Colours**: Colour a card's left edge from rules written in the query syntax
- **Click to Open**: Click on any task card to open the source file

## Installation

This is a fork of [Tasks Kanban](https://github.com/Djiit/obsidian-tasks-kanban) that adds tag-based columns. It ships under its own plugin id (`tasks-kanban-tags`), so it can be installed alongside the original, and it is not in the Community Plugins listing — install it manually.

1. Install the [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin from Obsidian Community Plugins
2. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Akergez/obsidian-tasks-kanban/releases/latest)
3. Copy them into your vault's `.obsidian/plugins/tasks-kanban-tags/` folder
4. Reload Obsidian and enable both the Tasks and Tasks Kanban Tags plugins in Settings

## Usage

### Opening a board

From the command palette:

- **Open board** — opens the base board (the shared base query, no file)
- **Open board…** — pick one of your board files to open
- **Create new board** — create a fresh `.kanban` file and open it
- **Open weekly planner** — open the weekly planner (also on the ribbon)

Or just click a `.kanban` file in the file explorer.

Each board opens in its own tab; opening a board that's already open focuses its tab.

### Weekly planner

The calendar button in the left ribbon opens the **weekly planner**: a [week board](#week-columns) with one column per weekday, Monday through Sunday, led by an **Unplanned** pool.

There is exactly one planner note, and it is the board for *every* week:

- The columns are the days of whichever week you are looking at. The `‹ 2026-W35 ›` control above the board pages a week back or forward; clicking the week itself returns to the one you are in.
- Nothing in the note names a week, so there is no file per week to create, find or keep in step — pinning a card to next Thursday is done on the board, not by opening another one.
- The first time you use it, the note is written to the **Weekly planner note** path (plugin Settings → Boards; default `Kanban/Weekly.md`). After that it is yours: edit its columns, pool, actions and query like any other board and every week gets them.

Weeks start on Monday. The planner plans by the **scheduled** date; change the board's date field from its gear button if you'd rather plan by due date.

The **Unplanned** pool collects unfinished work with no day, or a day older than the week's Monday, minus anything tagged for a *different* week. A card's right-click menu offers **Next week** — which clears its day and moves its `#w35_2026` preplanning tag on to the next week, so it leaves this week and shows up when you page forward — plus **Cancel** and **Done**.

Since the note lives in the boards folder, the planner also shows up in *Open board…* like any other board.

### Columns

Every board has a **board type**, chosen explicitly in that board's settings (the gear button above the board), that says what its columns are: **status columns**, **tag columns**, **date columns**, or **week columns**. Switching type keeps the other types' settings, so you can switch back without re-entering them.

#### Status columns

The default. One column per status type (Todo, In Progress, Done, Cancelled), derived from your Tasks status configuration.

You can instead define **custom columns** per board, in its settings. Each custom column is a partition over status symbols — pick which statuses it collects, and the first one becomes the symbol written when you drop a card into it. This lets you, for example, split "In Progress" into separate "Ongoing" (`/`) and "In Review" (`A`) columns.

#### Tag columns

Set a board's **column tag prefix** to build its columns from tags. With the prefix `sprint`, every distinct `#sprint_<column>` tag on your tasks becomes a column:

```markdown
- [ ] Write the spec #sprint_todo
- [ ] Review the PR #sprint_in_progress
- [x] Ship it #sprint_done
```

gives the columns *In progress*, *Todo* and *Done*, plus a leading **No column** for tasks carrying no `#sprint_…` tag. Dropping a card rewrites that tag in the source file — the task's `[ ]` status is left alone.

By default the columns are ordered alphabetically. Set **Column order** to arrange them yourself — a comma-separated list of column names (the part after the prefix), leftmost first:

```
todo, doing, done
```

Anything not listed follows alphabetically, so a new tag still shows up somewhere predictable. A listed column appears even when no task carries its tag yet, which is how you keep an empty column on the board to drop cards into.

#### Date columns

A date board has one column per day you name. Pick the **date field** the columns apply to — created, start, scheduled (the default), due, done or cancelled — then add a column for each day:

| Column name | Date         |
| ----------- | ------------ |
| Monday      | `2026-08-24` |
| Tuesday     | `2026-08-25` |
| Wednesday   | `2026-08-26` |

A task lands in the column whose day matches its value for that field. Leaving a column's name empty labels it with the date itself. Columns stay in the order you add them — they are not re-sorted by date.

There is always a leading **No date** column for tasks with no date in that field.

Two rules make a date board a deliberately narrow view:

- **A task whose date matches no column is hidden.** That is the point — a week board shows that week, not everything ever scheduled. Use it together with the query to control what reaches the board at all.
- **Dropping a card writes that column's day into the field**, in your Task Format (see below). Dropping into **No date** removes the date. The `[ ]` status is left alone.

Dates are exact days (`YYYY-MM-DD`), so a date board is a snapshot of named days rather than a rolling window.

#### Week columns

A week board is a date board whose seven days it does not store: they are built for **the week you are looking at**, Monday to Sunday, every time the board is drawn. That is what lets one note be the planner for every week — the arrows above the board page between them, and the file never changes.

Because no week is written down, the week has to be spelled out where a board would otherwise name a date. In a week board's filters, mutations and colour rules, these placeholders stand for the week on screen:

| Placeholder                      | For `2026-W35` |
| -------------------------------- | -------------- |
| `{{week}}` / `{{ww}}`            | `35` / `35`    |
| `{{year}}`                       | `2026`         |
| `{{monday}}` … `{{sunday}}`      | `2026-08-24` … |
| `{{nextWeek}}` / `{{nextYear}}`  | `36` / `2026`  |
| `{{prevWeek}}` / `{{prevYear}}`  | `34` / `2026`  |
| `{{nextMonday}}`                 | `2026-08-31`   |

They are substituted on the way to the screen and never written back, so the file keeps saying `{{monday}}`. Neighbouring weeks come as their own number/year pairs because arithmetic would be wrong exactly when it matters: week 53 of 2026 is followed by week 1 of **2027**.

The board's **query** is not templated — the search, sort and group bars edit it as structure and write it back, so a placeholder there would not survive. A week board narrows itself with its columns instead.

Folding is by weekday, not by date: fold Saturday and it stays folded as you page through the weeks.

#### Task format

Dragging a card onto a date column writes a date into your note. **Settings → Tasks integration → Task format** decides how:

- **Follow the Tasks plugin** (default) — read Tasks' own **Task Format** setting
- **Emoji** — `⏳ 2026-08-24`, `📅 2026-08-24`, …
- **Dataview** — `[scheduled:: 2026-08-24]`, `[due:: 2026-08-24]`, …

The same setting governs the done/cancelled dates written on a status change. A date written in the *other* format is never touched: Tasks would not have read it as a date either, so it counts as your own text.

### Boards are files

Each board is a `.kanban` file in your vault. Click it in the file explorer and the board opens — it syncs, versions and moves like any other note. The file is YAML, so it stays readable and hand-editable:

```yaml
name: Sprint
boardType: tag
columnTagPrefix: sprint
columnOrder: todo, doing, done

query: |-
  tag includes #work
  not done
  sort by due

cardColors: |-
  tag includes #urgent -> red
  folder includes Work/ -> #3b82f6

collapsedColumns: []
collapsedGroups: []
```

A date board carries its field and days instead:

```yaml
name: This week
boardType: date
dateField: scheduled

dateColumns:
  - id: 8f1c…
    title: Monday
    date: "2026-08-24"
  - id: 2a70…
    title: Tuesday
    date: "2026-08-25"

collapsedColumns: []
collapsedGroups: []
```

A week board carries the field but no days at all — they are built for the week being shown:

```yaml
name: Weekly
boardType: week
dateField: scheduled
noDateColumn: false

actions:
  - id: action:next-week
    title: Next week
    mutation: |-
      clear scheduled date
      remove tag #w{{week}}_{{year}}
      add tag #w{{nextWeek}}_{{nextYear}}

collapsedColumns: []
collapsedGroups: []
```

Everything about a board lives in its file, including which columns and swimlanes you have folded. Boards written before board types were explicit have no `boardType:` key; they keep the type their column-tag prefix used to imply, and gain the key the next time they are saved.

A board is configured **on the board**: the gear button above it opens that board's settings — its query, board type, columns and card colours. They are written back to its file on Save.

Plugin **Settings** keeps only what is shared across every board: the task format, the **base query** and **base card colours** merged into each board, and the folders boards are created in (**Boards folder**, default `Kanban`; empty means the vault root).

The **base board** is the exception: it has no file. It is opened with the *Open board* command, and its own settings — including the base query and colours it shares with every other board — are stored in the plugin's data.

Inline edits from a board's search/sort/group bars are saved back to that board's file.

### Filtering, sorting, and grouping

The board supports a subset of Tasks query syntax. For complete documentation, see [Query Syntax](docs/query-syntax.md).

**Filtering:**
- `tag includes #<tag>` — show tasks with the specified tag
- `description includes <text>` — show tasks whose description contains the text
- `path` / `filename` / `folder` `includes <text>` — filter by where the task lives

**Sorting:**
- `sort by <field>` / `sort by <field> reverse`
- Fields: `due`, `scheduled`, `start`, `created`, `priority`, `filename`

**Grouping** (into foldable swimlanes):
- `group by <field>` / `group by <field> reverse`
- Fields: `status`, `priority`, `tags`, `path`, `folder`, `filename`

Date-based grouping is intentionally not offered, since one lane per distinct date scatters the board.

The search and sort/group bars above the board edit the same query visually; the filter button opens the raw query editor.

### Nested tasks

A task indented under another task doesn't get a card of its own — it is listed inside its parent's card, with a `done/total` counter and completed lines struck through. Nesting is read from the source file: within one note, a task belongs to the closest task above it with a smaller indent, and every descendant (however deep) is listed in the top-level task's card.

```markdown
- [ ] Ship the release #sprint_doing
    - [x] Write the changelog
    - [ ] Tag the build
        - [ ] Upload assets
```

Nested tasks are not board citizens: **their tags are ignored everywhere** — they never appear in the tag filter, never create or move tag columns, and queries never match them. Only the parent card carries tags. Dragging a card moves the parent task; the nested lines stay where they are.

### Card colours

Rules paint a card's left edge. One rule per line: a filter, then `->`, then a CSS colour.

```
tag includes #urgent -> red
status.type is IN_PROGRESS -> #3b82f6
due before today -> orange
```

They live in two places, and both apply:

- **Base card colours** (Settings → Shared across every board) — the shared palette, applied to every board.
- A board's own rules (gear button on the board) — for that board only.

A board's own rules are checked first and the shared ones follow, so a board can override a shared colour and still inherit every rule it does not mention. Within each group the topmost line wins, so put the most specific rule at the top.

### Drag & Drop

- Drag a task card from one column and drop it on another to move it
- The dropped card takes the target column's status symbol — or, on a tag-column board, its `#<prefix>_<column>` tag
- The source file is updated and the board refreshes to show the change

## Comparison

The key difference between Kanban plugins is *what a card is* — and, when cards are tasks, *where the task data comes from*:

| Plugin | Cards are… | Built on |
|--------|------------|----------|
| [Kanban](https://github.com/mgmeyers/obsidian-kanban) | **notes** — a board is its own note, each card a line of Markdown living only on that board | self-contained board note |
| [Kanban Bases View](https://community.obsidian.md/plugins/kanban-bases-view) | **notes** — one card per note, columns from a frontmatter/Base property | [Obsidian Bases](https://help.obsidian.md/bases) |
| [Task Board](https://github.com/tu2-atmanand/Task-Board) | **tasks** — checkbox lines scanned from across your vault | its own task scanner (reads Tasks-compatible formats, but parses independently) |
| **Tasks Kanban** (this) | **tasks** — cards *are* your real tasks, wherever they already live in your vault | [Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) |

Because this plugin is built on Tasks, the board is a **live view over your existing tasks** (filtered, sorted, grouped) rather than a separate copy to keep in sync. Move a card and it rewrites the task's status in its source file. It reuses the Tasks plugin's own parser and query engine, so your tasks behave consistently between Tasks queries and the board.

Choose this if your work already lives as `- [ ]` tasks scattered across your notes and you already use Tasks; choose [Task Board](https://github.com/tu2-atmanand/Task-Board) if you want a task board without depending on the Tasks plugin; choose a note-based board if you'd rather each card be a whole note.

## Development

### Building

```bash
# Install dependencies
npm install

# Build for production (minified)
npm run build
```

### Development Commands (Obsidian CLI)

Use the [Obsidian CLI](https://help.obsidian.md/cli) for faster development:

| Command | Action |
|---------|--------|
| `obsidian plugin:reload id=tasks-kanban-tags` | Reload plugin without restarting Obsidian |
| `obsidian dev:errors` | Check for plugin errors |
| `obsidian dev:console level=error` | View console errors |
| `obsidian dev:screenshot path=screenshot.png` | Capture current view |
| `obsidian dev:dom selector=".workspace-leaf"` | Inspect DOM elements |
| `obsidian dev:css selector=".workspace-leaf" prop=background-color` | Check CSS values |
| `obsidian dev:mobile on` | Enable mobile emulation |
| `obsidian eval code="app.plugins.getPlugin('tasks-kanban-tags')"` | Access plugin instance |

### Quick Development Cycle

```bash
# In one terminal: watch for changes
npm run dev

# In another terminal or Obsidian CLI: reload after changes
npm run dev:reload

# Or use the full cycle
npm run dev:full
```

### Testing

Tests use Vitest with JSDom environment. Test files are in the `tests/` directory.

```bash
npm test        # Run all tests once
npm run test:watch  # Watch mode for development
```

### Type Checking

```bash
npm run typecheck   # Type-check without emitting output
```

### Git Hooks

[Husky](https://typicode.github.io/husky/) hooks are installed automatically on
`npm install` (via the `prepare` script):

- **pre-commit**: runs `lint-staged` (ESLint + Prettier on staged files) followed
  by `npm run typecheck`.
- **commit-msg**: validates the message with [commitlint](https://commitlint.js.org/)
  against the [Conventional Commits](https://www.conventionalcommits.org/) spec.

## License

MIT
