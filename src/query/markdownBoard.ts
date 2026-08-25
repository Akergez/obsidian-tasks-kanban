/**
 * A board lives inside an ordinary note, as a fenced code block:
 *
 * ```` markdown
 * # My board
 *
 * ```tasks-kanban
 * boardType: date
 * …
 * ```
 * ````
 *
 * The block's body is the board document (see query/boardFile), so a board is
 * editable in Obsidian's own editor — which is the whole point of carrying it
 * in a note rather than in a file only this plugin can open.
 */
export const BOARD_BLOCK_LANGUAGE = "tasks-kanban";

/** The opening fence of a board block, with any indentation it was written at. */
const OPEN_FENCE = new RegExp(
  String.raw`^(\s*)(\`{3,})\s*${BOARD_BLOCK_LANGUAGE}\s*$`,
  "i",
);

/** One board block found in a note. */
export interface BoardBlockLocation {
  /** The block's body: everything between the fences, fences excluded. */
  body: string;
  /** 0-based line of the opening fence — the same number getSectionInfo gives. */
  lineStart: number;
  /** 0-based line of the closing fence. */
  lineEnd: number;
}

/** Wrap a board document in the fenced block a note carries it in. */
export function boardBlock(body: string): string {
  return ["```" + BOARD_BLOCK_LANGUAGE, body.replace(/\n+$/, ""), "```"].join(
    "\n",
  );
}

/**
 * A whole note holding one board: a heading, then the block. Written when the
 * plugin creates a board of its own; a user can put the block anywhere.
 */
export function boardNote(title: string, body: string): string {
  return `# ${title}\n\n${boardBlock(body)}\n`;
}

/**
 * Find the first board block in a note, or null when it holds none.
 *
 * Used where the plugin reads a board it has not been handed by Obsidian (the
 * picker, the settings pane). The rendered board itself never needs this: the
 * code-block processor is given the body and the section's line range.
 */
export function findBoardBlock(text: string): BoardBlockLocation | null {
  const lines = text.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const open = OPEN_FENCE.exec(lines[index]);
    if (!open) {
      continue;
    }
    // The closing fence is at least as long as the opening one, per CommonMark.
    const close = new RegExp(String.raw`^\s*\`{${open[2].length},}\s*$`);
    for (let end = index + 1; end < lines.length; end += 1) {
      if (close.test(lines[end])) {
        return {
          body: lines.slice(index + 1, end).join("\n"),
          lineStart: index,
          lineEnd: end,
        };
      }
    }
    // An unclosed fence runs to the end of the note; Obsidian reads it that way
    // too, so the board is still there to be found.
    return {
      body: lines.slice(index + 1).join("\n"),
      lineStart: index,
      lineEnd: lines.length - 1,
    };
  }

  return null;
}

/**
 * Replace the body of the block spanning `lineStart`…`lineEnd` (the fences
 * included, as Obsidian's `getSectionInfo` reports them), leaving every other
 * line of the note untouched — the board owns its block and nothing else.
 *
 * Returns the note unchanged when the range does not look like a fenced block,
 * which is the safe answer: better a fold that fails to persist than a write
 * that eats a paragraph.
 */
export function replaceBoardBlockBody(
  text: string,
  lineStart: number,
  lineEnd: number,
  body: string,
): string {
  const lines = text.split("\n");
  if (
    lineStart < 0 ||
    lineEnd >= lines.length ||
    lineEnd <= lineStart ||
    !OPEN_FENCE.test(lines[lineStart])
  ) {
    return text;
  }

  const replacement = body === "" ? [] : body.replace(/\n+$/, "").split("\n");
  return [
    ...lines.slice(0, lineStart + 1),
    ...replacement,
    ...lines.slice(lineEnd),
  ].join("\n");
}
