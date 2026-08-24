import { describe, it, expect } from "vitest";
import {
  locationValue,
  matchesLocationFilter,
  parseLocationFilter,
  serializeLocationFilter,
  type LocationFilterInstruction,
} from "../src/utils/locationFilter";
import type { Task } from "../src/services/TasksIntegration";

function task(path: string | undefined): Task {
  return {
    id: "1",
    description: "Test task",
    status: { symbol: " ", name: "Todo", type: "TODO" },
    tags: [],
    priority: null,
    dueDate: null,
    startDate: null,
    scheduledDate: null,
    doneDate: null,
    createdDate: null,
    cancelledDate: null,
    dependsOn: [],
    recurrence: null,
    taskLocation: path ? { path, lineNumber: 1 } : (undefined as never),
    originalMarkdown: "- [ ] Test task",
  };
}

/** Parse and assert it produced a filter (not an error / not null). */
function parsed(line: string): LocationFilterInstruction {
  const result = parseLocationFilter(line);
  if (!result || "error" in result) {
    throw new Error(
      `expected a filter for "${line}", got ${JSON.stringify(result)}`,
    );
  }
  return result.filter;
}

describe("locationValue", () => {
  const t = task("Work/Projects/Alpha.md");

  it("keeps the extension in path and filename, as Tasks does", () => {
    expect(locationValue(t, "path")).toBe("Work/Projects/Alpha.md");
    expect(locationValue(t, "filename")).toBe("Alpha.md");
  });

  it("returns the containing folder with a trailing slash", () => {
    expect(locationValue(t, "folder")).toBe("Work/Projects/");
  });

  it("uses / as the folder for a vault-root file", () => {
    expect(locationValue(task("Inbox.md"), "folder")).toBe("/");
    expect(locationValue(task("Inbox.md"), "filename")).toBe("Inbox.md");
  });

  it("is empty for a task with no location", () => {
    expect(locationValue(task(undefined), "path")).toBe("");
  });
});

describe("parseLocationFilter", () => {
  it("parses includes / does not include for every field", () => {
    expect(parsed("path includes Work")).toEqual({
      kind: "location",
      field: "path",
      test: "includes",
      value: "Work",
      negated: false,
    });
    expect(parsed("filename does not include Archive").negated).toBe(true);
    expect(parsed("folder includes Work/").field).toBe("folder");
  });

  it("is case-insensitive in the instruction itself", () => {
    expect(parsed("PATH INCLUDES Work").field).toBe("path");
  });

  it("parses the regex forms", () => {
    expect(parsed("path regex matches /^Work\\//i")).toEqual({
      kind: "location",
      field: "path",
      test: "regex",
      value: "^Work\\/",
      flags: "i",
      negated: false,
    });
    expect(parsed("filename regex does not match /^_/").negated).toBe(true);
  });

  it("reports an invalid regular expression", () => {
    expect(
      parseLocationFilter("path regex matches /[unclosed/"),
    ).toHaveProperty("error");
  });

  it("reports an empty value", () => {
    expect(parseLocationFilter("path includes   ")).toHaveProperty("error");
  });

  it("returns null for lines that are not location filters", () => {
    expect(parseLocationFilter("tag includes #work")).toBeNull();
    expect(
      parseLocationFilter("description includes path includes"),
    ).toBeNull();
    expect(parseLocationFilter("sort by due")).toBeNull();
  });
});

describe("serializeLocationFilter", () => {
  it("round-trips every supported spelling", () => {
    const lines = [
      "path includes Work",
      "path does not include Archive",
      "filename includes Alpha.md",
      "folder does not include Inbox",
      "path regex matches /^Work/i",
      "filename regex does not match /^_/",
    ];
    for (const line of lines) {
      expect(serializeLocationFilter(parsed(line))).toBe(line);
    }
  });
});

describe("matchesLocationFilter", () => {
  const t = task("Work/Projects/Alpha.md");

  it("matches a path substring case-insensitively", () => {
    expect(matchesLocationFilter(t, parsed("path includes projects"))).toBe(
      true,
    );
    expect(matchesLocationFilter(t, parsed("path includes Nope"))).toBe(false);
  });

  it("negates does not include", () => {
    expect(
      matchesLocationFilter(t, parsed("path does not include Archive")),
    ).toBe(true);
    expect(
      matchesLocationFilter(t, parsed("path does not include Projects")),
    ).toBe(false);
  });

  it("matches filename without seeing the folder", () => {
    expect(matchesLocationFilter(t, parsed("filename includes Alpha"))).toBe(
      true,
    );
    expect(matchesLocationFilter(t, parsed("filename includes Work"))).toBe(
      false,
    );
  });

  it("matches folder without seeing the file name", () => {
    expect(matchesLocationFilter(t, parsed("folder includes Work/"))).toBe(
      true,
    );
    expect(matchesLocationFilter(t, parsed("folder includes Alpha"))).toBe(
      false,
    );
  });

  it("applies the regex case-sensitively unless the i flag is given", () => {
    expect(matchesLocationFilter(t, parsed("path regex matches /^work/"))).toBe(
      false,
    );
    expect(
      matchesLocationFilter(t, parsed("path regex matches /^work/i")),
    ).toBe(true);
  });

  it("does not match a task with no location", () => {
    expect(
      matchesLocationFilter(task(undefined), parsed("path includes Work")),
    ).toBe(false);
  });
});
