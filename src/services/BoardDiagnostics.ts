import { MarkdownView, TFile, type App } from "obsidian";

import { findBoardBlock } from "../query/markdownBoard";
import { boardViewFailures, TasksBoardView } from "../views/TasksBoardView";
import type { BoardNotes } from "./BoardNotes";

/**
 * What the plugin knows about the note in front of you, and what the file
 * explorer's row for it actually looks like.
 *
 * Exists because the two things that decide whether a board opens as a board —
 * Obsidian's view swapping and the DOM of its file explorer — cannot be
 * exercised by the test suite or read off the source: they only exist inside a
 * running Obsidian. Rather than guess at them from outside, this prints the
 * facts, so one reload answers the question instead of one more round of
 * changes made blind.
 */
export interface BoardDiagnosticsReport {
  /** One line per fact, in the order they were gathered. */
  lines: string[];
  /** A one-line summary, short enough for a Notice. */
  summary: string;
}

/** A leaf's id, when Obsidian gives one. */
function leafId(leaf: unknown): string {
  return (leaf as { id?: string }).id ?? "?";
}

/** Cut a long string down for a log line, saying how much was left out. */
function clip(value: string, limit = 600): string {
  return value.length <= limit
    ? value
    : `${value.slice(0, limit)}… (+${value.length - limit} chars)`;
}

/**
 * Gather everything worth knowing about why a board did or did not open.
 * Reads only; changes nothing.
 */
export async function collectBoardDiagnostics(
  app: App,
  boards: BoardNotes,
  version: string,
  boardViewType: string,
): Promise<BoardDiagnosticsReport> {
  const lines: string[] = [`Tasks Kanban ${version}`];

  const registered = Boolean(
    (
      app as unknown as {
        viewRegistry?: { getViewCreatorByType?: (type: string) => unknown };
      }
    ).viewRegistry?.getViewCreatorByType?.(boardViewType),
  );
  lines.push(`board view "${boardViewType}" registered: ${registered}`);

  const leaves = app.workspace.getLeavesOfType("markdown");
  lines.push(`markdown leaves open: ${leaves.length}`);
  for (const leaf of leaves) {
    const view = leaf.view;
    const path = view instanceof MarkdownView ? view.file?.path : undefined;
    lines.push(
      `  leaf ${leafId(leaf)}: type=${leaf.getViewState().type} file=${path ?? "—"}`,
    );
  }
  const boardLeaves = app.workspace.getLeavesOfType(boardViewType);
  lines.push(`board leaves open: ${boardLeaves.length}`);
  for (const leaf of boardLeaves) {
    const view = leaf.view;
    if (!(view instanceof TasksBoardView)) {
      lines.push(`  leaf ${leafId(leaf)}: view is not a board view (?)`);
      continue;
    }
    const el = view.contentEl;
    lines.push(
      `  leaf ${leafId(leaf)}: file=${view.file?.path ?? "—"} ` +
        `block=${view.hasBoard()} built=${view.isRendered()}`,
    );
    lines.push(
      `    size: ${Math.round(el.clientWidth)}×${Math.round(el.clientHeight)} ` +
        `boardEl=${el.querySelector(".tasks-kanban-board") !== null} ` +
        `columns=${el.querySelectorAll(".tasks-kanban-column").length} ` +
        `cards=${el.querySelectorAll(".tasks-kanban-card").length}`,
    );
    lines.push(`    html: ${clip(el.innerHTML, 300)}`);
  }

  if (boardViewFailures.length > 0) {
    lines.push("board view failures:");
    for (const failure of boardViewFailures) {
      lines.push(`  ${clip(failure, 500)}`);
    }
  } else {
    lines.push("board view failures: none recorded");
  }

  const file = app.workspace.getActiveFile();
  if (!(file instanceof TFile)) {
    lines.push("active file: none — open the board note first");
    return { lines, summary: "No active file; open the board note and retry." };
  }

  lines.push(`active file: ${file.path}`);

  const frontmatter = app.metadataCache.getCache(file.path)?.frontmatter;
  lines.push(
    `  frontmatter: ${frontmatter ? JSON.stringify(frontmatter) : "none"}`,
  );

  const content = await app.vault.cachedRead(file);
  const block = findBoardBlock(content);
  lines.push(
    `  board block: ${block ? `lines ${block.lineStart}–${block.lineEnd}` : "not found"}`,
  );
  lines.push(`  first line: ${JSON.stringify(content.split("\n")[0] ?? "")}`);

  const declared = boards.isBoard(file.path);
  const detected = await boards.isBoardFile(file);
  lines.push(`  isBoard (cache only): ${declared}`);
  lines.push(`  isBoardFile (reads file): ${detected}`);

  const row = document.querySelector<HTMLElement>(
    `.nav-file-title[data-path="${CSS.escape(file.path)}"]`,
  );
  if (row) {
    lines.push(
      `  explorer row marked: ${row.hasAttribute("data-tasks-kanban")}`,
    );
    lines.push(
      `  board badge present: ${row.querySelector(".tasks-kanban-file-icon") !== null}`,
    );
    lines.push(`  explorer row HTML: ${clip(row.outerHTML)}`);
  } else {
    lines.push(
      "  explorer row: not on screen (reveal the file in the explorer)",
    );
  }

  const summary = detected
    ? `Recognised as a board (block: ${block ? "yes" : "no"}).`
    : "NOT recognised as a board.";

  return { lines, summary };
}
