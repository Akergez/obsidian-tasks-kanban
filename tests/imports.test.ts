import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * A circular *value* import survives typecheck and vitest and then breaks only
 * in the bundle, where one side of the cycle is `undefined` at module-init
 * time — a function that silently isn't there. That is exactly how opening a
 * board stopped working (services/BoardNotes ⇄ query/markdownBoard), so the
 * shape of that bug gets a test rather than another round of debugging.
 */
const SRC = resolve(__dirname, "../src");

/** Every .ts file under `dir`, as paths relative to src. */
function sources(dir: string = SRC): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sources(path));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      found.push(relative(SRC, path));
    }
  }
  return found;
}

/**
 * The modules `file` imports **values** from, as src-relative paths.
 *
 * Type-only imports are skipped: they are erased before the bundle exists, so
 * a cycle through one cannot break anything at runtime.
 */
function valueImports(file: string): string[] {
  const text = readFileSync(join(SRC, file), "utf8");
  const targets: string[] = [];

  for (const match of text.matchAll(
    /import\s+([\s\S]*?)\s*from\s*["'](\.[^"']*)["']/g,
  )) {
    const clause = match[1];
    const target = match[2];

    if (/^type\s/.test(clause)) {
      continue;
    }
    // `import { type A, type B }` is type-only too, however it is spelled.
    const braces = /^\{([\s\S]*)\}$/.exec(clause.trim());
    if (
      braces &&
      braces[1]
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "")
        .every((part) => part.startsWith("type "))
    ) {
      continue;
    }

    const resolved = relative(SRC, resolve(dirname(join(SRC, file)), target));
    targets.push(`${resolved}.ts`);
  }

  return targets;
}

/** The first import cycle in `graph`, as the path around it, or null. */
function findCycle(graph: Map<string, string[]>): string[] | null {
  const visiting = new Set<string>();
  const done = new Set<string>();

  const walk = (node: string, trail: string[]): string[] | null => {
    if (visiting.has(node)) {
      return [...trail.slice(trail.indexOf(node)), node];
    }
    if (done.has(node)) {
      return null;
    }
    visiting.add(node);
    for (const next of graph.get(node) ?? []) {
      const cycle = walk(next, [...trail, node]);
      if (cycle) {
        return cycle;
      }
    }
    visiting.delete(node);
    done.add(node);
    return null;
  };

  for (const node of graph.keys()) {
    const cycle = walk(node, []);
    if (cycle) {
      return cycle;
    }
  }
  return null;
}

describe("findCycle", () => {
  it("finds a cycle and reports the way around it", () => {
    const graph = new Map([
      ["a.ts", ["b.ts"]],
      ["b.ts", ["c.ts"]],
      ["c.ts", ["a.ts"]],
    ]);
    expect(findCycle(graph)).toEqual(["a.ts", "b.ts", "c.ts", "a.ts"]);
  });

  it("says nothing about a graph that has none", () => {
    const graph = new Map([
      ["a.ts", ["b.ts", "c.ts"]],
      ["b.ts", ["c.ts"]],
      ["c.ts", []],
    ]);
    expect(findCycle(graph)).toBeNull();
  });
});

describe("the plugin's own modules", () => {
  it("import no module that imports them back", () => {
    const graph = new Map(
      sources().map((file) => [file, valueImports(file)] as const),
    );
    const cycle = findCycle(graph);
    expect(cycle, cycle ? `import cycle: ${cycle.join(" → ")}` : "").toBeNull();
  });
});
