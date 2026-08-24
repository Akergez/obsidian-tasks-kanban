# Obsidian Tasks Kanban

A Kanban board view plugin for Obsidian that displays Tasks in a visual board layout.

> **How does this plugin compare to other Kanban ones?** See [Comparison](#comparison).

## Features

- **Kanban Board View**: Display your tasks in a Kanban-style board with a column per status
- **Boards Are Files**: Each board is a readable `.kanban` YAML file in your vault — click it to open, and it syncs and versions like any note
- **Base Query**: A shared query merged into every board, so common filters live in one place
- **Custom Columns**: Optionally replace the default status columns with your own, mapping each column to specific status symbols (e.g. split "In Progress" into "Ongoing" `/` and "In Review" `A`)
- **Grouping (Swimlanes)**: Group cards into foldable lanes by status, priority, tags, path, folder, or filename
- **Sorting**: Sort cards by priority or a date field, ascending or descending
- **Filtering**: Search bar for title and tags, plus full Tasks-style query editing
- **Drag & Drop**: Move tasks between columns to change their status
- **Tasks Integration**: Listens to Tasks plugin events for real-time updates
- **Task Format Aware**: Writes done/cancelled dates in whichever format Tasks' own **Task Format** setting specifies — emoji (`✅ 2026-08-04`) or Dataview (`[completion:: 2026-08-04]`)
- **Card Design**: The task text reads as the card's title, with tags and the parent note's name in the footer
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

Or just click a `.kanban` file in the file explorer.

Each board opens in its own tab; opening a board that's already open focuses its tab.

### Columns

By default the board shows one column per status type (Todo, In Progress, Done, Cancelled), derived from your Tasks status configuration.

You can instead define **custom columns** per board in Settings. Each custom column is a partition over status symbols — pick which statuses it collects, and the first one becomes the symbol written when you drop a card into it. This lets you, for example, split "In Progress" into separate "Ongoing" (`/`) and "In Review" (`A`) columns.

#### Tag columns

Set a board's **column tag prefix** in Settings to build its columns from tags instead of statuses. With the prefix `sprint`, every distinct `#sprint_<column>` tag on your tasks becomes a column:

```markdown
- [ ] Write the spec #sprint_todo
- [ ] Review the PR #sprint_in_progress
- [x] Ship it #sprint_done
```

gives the columns *In progress*, *Todo* and *Done*, plus a leading **No column** for tasks carrying no `#sprint_…` tag. Dropping a card rewrites that tag in the source file — the task's `[ ]` status is left alone. Clearing the prefix returns the board to status columns.

By default the columns are ordered alphabetically. Set **Column order** to arrange them yourself — a comma-separated list of column names (the part after the prefix), leftmost first:

```
todo, doing, done
```

Anything not listed follows alphabetically, so a new tag still shows up somewhere predictable. A listed column appears even when no task carries its tag yet, which is how you keep an empty column on the board to drop cards into.

### Boards are files

Each board is a `.kanban` file in your vault. Click it in the file explorer and the board opens — it syncs, versions and moves like any other note. The file is YAML, so it stays readable and hand-editable:

```yaml
name: Sprint
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

Everything about a board lives in its file, including which columns and swimlanes you have folded.

Boards are still configured in **Settings**, which lists every board file and writes your edits back to it on Save. The **Boards folder** setting says where new boards are created and which folder is listed (default `Kanban`; empty means the vault root).

The **base board** is the exception: it has no file. It is the shared **base query** merged on top of every board, opened with the *Open board* command and configured in Settings.

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

Each card has a **spine** — a coloured strip down its left edge — that you can drive from board settings. Add one rule per line under **Card colours**: a filter, `->`, and a CSS colour.

```
tag includes #urgent -> red
status.type is IN_PROGRESS -> #3b82f6
folder includes Work/ -> #3b82f6
path does not include Archive -> orange
not done -> var(--text-muted)
```

The filter is the same syntax as the board query, so anything you can filter on you can colour on. The **first matching rule wins**, so put the most specific ones at the top; a card matching no rule gets no spine. Named colours, hex, `rgb()`/`hsl()` and `var(--…)` all work.

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
