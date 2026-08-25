import type { FilterInstruction } from "../query/boardQuery";

/**
 * The boolean combinators, spelled as in the Tasks reference
 * (https://publish.obsidian.md/tasks/Queries/Combining+Filters).
 */
export type BooleanOp = "and" | "or" | "xor" | "not";

/**
 * A filter built out of other filters. `not` always holds exactly one operand;
 * the rest hold two or more (a chain of the same operator is flattened into a
 * single node, so `(a) OR (b) OR (c)` is one three-operand node).
 */
export interface BooleanFilterInstruction {
  kind: "boolean";
  op: BooleanOp;
  operands: FilterInstruction[];
}

/**
 * One token of a boolean line: either a parenthesised sub-expression (kept as
 * its raw inner text, parsed later) or one of the operators.
 */
type Token = { type: "group"; text: string } | { type: "op"; op: BooleanOp };

/** How the operators bind: `NOT` tightest, then `AND`, then `XOR`, then `OR`. */
const PRECEDENCE: Record<Exclude<BooleanOp, "not">, number> = {
  and: 3,
  xor: 2,
  or: 1,
};

/**
 * Split a boolean line into groups and operators.
 *
 * Returns null for anything that is not a boolean expression, which is what
 * keeps ordinary filters working: the operators are recognised only in capitals
 * and only *outside* parentheses, and every sub-filter must be parenthesised —
 * so `description includes cats and dogs` (bare text, lowercase `and`) is not a
 * boolean line, and neither is `status.name regex matches /(a|b)/`, whose text
 * starts before its first bracket.
 */
function tokenize(line: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;

  while (index < line.length) {
    const char = line[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "(") {
      let depth = 0;
      let end = index;
      for (; end < line.length; end += 1) {
        if (line[end] === "(") {
          depth += 1;
        } else if (line[end] === ")") {
          depth -= 1;
          if (depth === 0) {
            break;
          }
        }
      }
      if (depth !== 0) {
        return null;
      }
      tokens.push({ type: "group", text: line.slice(index + 1, end) });
      index = end + 1;
      continue;
    }

    const operator = /^(AND|OR|XOR|NOT)\b/.exec(line.slice(index));
    if (operator) {
      tokens.push({ type: "op", op: operator[1].toLowerCase() as BooleanOp });
      index += operator[1].length;
      continue;
    }

    return null;
  }

  return tokens;
}

/**
 * Parse one line as a boolean combination of filters, e.g.
 * `(no scheduled date) OR (scheduled before today)`.
 *
 * Returns null when the line is not a boolean expression at all, so the caller
 * can go on trying the other filter kinds; an `error` when it clearly is one
 * (it starts with `(` or `NOT`) but does not parse. `parseLeaf` parses the text
 * inside a group that holds a plain filter — passed in rather than imported, so
 * this module stays independent of the query parser that owns it.
 */
export function parseBooleanFilter(
  line: string,
  parseLeaf: (
    text: string,
  ) => { filter: FilterInstruction } | { error: string },
): { filter: FilterInstruction } | { error: string } | null {
  const looksBoolean = /^\(/.test(line) || /^NOT\b/.test(line);
  const tokens = tokenize(line);

  if (tokens === null || tokens.length === 0) {
    return looksBoolean
      ? { error: `unbalanced parentheses in "${line}"` }
      : null;
  }
  if (!looksBoolean) {
    // Every boolean line opens with a group or with NOT, so anything else is a
    // plain filter line for the other parsers to claim.
    return null;
  }

  const parser = new TokenParser(tokens, parseLeaf);
  const result = parser.parseExpression(1);
  if ("error" in result) {
    return result;
  }
  if (!parser.done()) {
    return { error: `could not parse the boolean filter "${line}"` };
  }
  return { filter: result.filter };
}

/**
 * Precedence-climbing parser over the tokens of one line. Chains of the same
 * operator are flattened, so the node mirrors how the line reads.
 */
class TokenParser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly parseLeaf: (
      text: string,
    ) => { filter: FilterInstruction } | { error: string },
  ) {}

  done(): boolean {
    return this.index >= this.tokens.length;
  }

  parseExpression(
    minPrecedence: number,
  ): { filter: FilterInstruction } | { error: string } {
    let left = this.parseTerm();
    if ("error" in left) {
      return left;
    }

    for (;;) {
      const token = this.tokens[this.index];
      if (!token || token.type !== "op" || token.op === "not") {
        break;
      }
      const precedence = PRECEDENCE[token.op];
      if (precedence < minPrecedence) {
        break;
      }
      this.index += 1;
      const right = this.parseExpression(precedence + 1);
      if ("error" in right) {
        return right;
      }
      left = { filter: combine(token.op, left.filter, right.filter) };
    }

    return left;
  }

  private parseTerm(): { filter: FilterInstruction } | { error: string } {
    const token = this.tokens[this.index];
    if (!token) {
      return { error: "a boolean filter is missing an operand" };
    }

    if (token.type === "op") {
      if (token.op !== "not") {
        return {
          error: `"${token.op.toUpperCase()}" is missing its left side`,
        };
      }
      this.index += 1;
      const operand = this.parseTerm();
      if ("error" in operand) {
        return operand;
      }
      return {
        filter: { kind: "boolean", op: "not", operands: [operand.filter] },
      };
    }

    this.index += 1;
    const inner = token.text.trim();
    if (inner === "") {
      return { error: "empty ()" };
    }
    // A group may hold another boolean expression, or a plain filter.
    const nested = parseBooleanFilter(inner, this.parseLeaf);
    if (nested) {
      return nested;
    }
    return this.parseLeaf(inner);
  }
}

/** Join two filters under `op`, flattening a chain of the same operator. */
function combine(
  op: BooleanOp,
  left: FilterInstruction,
  right: FilterInstruction,
): FilterInstruction {
  if (left.kind === "boolean" && left.op === op && op !== "not") {
    return { kind: "boolean", op, operands: [...left.operands, right] };
  }
  return { kind: "boolean", op, operands: [left, right] };
}

/**
 * Serialize a boolean filter back to its canonical spelling: every operand
 * parenthesised, operators in capitals — the form the Tasks reference uses and
 * the one {@link parseBooleanFilter} reads back unchanged.
 */
export function serializeBooleanFilter(
  filter: BooleanFilterInstruction,
  serializeOperand: (operand: FilterInstruction) => string,
): string {
  const parts = filter.operands.map(
    (operand) => `(${serializeOperand(operand)})`,
  );
  if (filter.op === "not") {
    return `NOT ${parts[0]}`;
  }
  return parts.join(` ${filter.op.toUpperCase()} `);
}

/**
 * Whether a task satisfies a boolean filter. `matchesOperand` evaluates one
 * operand — again passed in, so the query module keeps ownership of what each
 * filter kind means.
 */
export function matchesBooleanFilter(
  filter: BooleanFilterInstruction,
  matchesOperand: (operand: FilterInstruction) => boolean,
): boolean {
  switch (filter.op) {
    case "not":
      return !matchesOperand(filter.operands[0]);
    case "and":
      return filter.operands.every(matchesOperand);
    case "or":
      return filter.operands.some(matchesOperand);
    case "xor":
      // Odd number of true operands, so a chain of XORs reads left to right.
      return filter.operands.filter(matchesOperand).length % 2 === 1;
  }
}
