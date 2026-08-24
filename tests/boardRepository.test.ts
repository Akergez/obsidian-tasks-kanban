import { describe, it, expect } from "vitest";
import {
  boardNameFromPath,
  sanitizeFileName,
} from "../src/services/BoardRepository";

describe("boardNameFromPath", () => {
  it("takes the base name without the extension", () => {
    expect(boardNameFromPath("Kanban/Sprint.kanban")).toBe("Sprint");
    expect(boardNameFromPath("Sprint.kanban")).toBe("Sprint");
  });

  it("ignores the extension's case", () => {
    expect(boardNameFromPath("Kanban/Sprint.KANBAN")).toBe("Sprint");
  });

  it("keeps dots that are part of the name", () => {
    expect(boardNameFromPath("Kanban/Q2.2026.kanban")).toBe("Q2.2026");
  });

  it("keeps a name that has no extension at all", () => {
    expect(boardNameFromPath("Kanban/Sprint")).toBe("Sprint");
  });
});

describe("sanitizeFileName", () => {
  it("strips characters a vault path cannot carry", () => {
    expect(sanitizeFileName('Q2: plan/review*"<>|')).toBe("Q2 planreview");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeFileName("  Sprint   board  ")).toBe("Sprint board");
  });

  it("can empty a name made only of illegal characters", () => {
    expect(sanitizeFileName("///")).toBe("");
  });

  it("leaves an ordinary name alone", () => {
    expect(sanitizeFileName("Sprint board")).toBe("Sprint board");
  });
});
