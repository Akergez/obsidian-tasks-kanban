import { describe, it, expect } from "vitest";
import {
  FIELD_SYNTAX,
  resolveTaskFormat,
  DEFAULT_TASK_FORMAT,
} from "../src/utils/taskFormat";

describe("resolveTaskFormat", () => {
  it("resolves 'dataview' to dataview", () => {
    expect(resolveTaskFormat("dataview")).toBe("dataview");
  });

  it.each([
    ["tasksPluginEmoji", "tasksPluginEmoji"],
    [undefined, "tasksPluginEmoji"],
    [null, "tasksPluginEmoji"],
    ["", "tasksPluginEmoji"],
    ["someFutureFormat", "tasksPluginEmoji"],
    [42, "tasksPluginEmoji"],
  ])("resolves %p to %p", (input, expected) => {
    expect(resolveTaskFormat(input)).toBe(expected);
  });

  it("matches Tasks' own default", () => {
    expect(resolveTaskFormat(undefined)).toBe(DEFAULT_TASK_FORMAT);
  });
});

describe("FIELD_SYNTAX render", () => {
  it("renders emoji done date", () => {
    expect(FIELD_SYNTAX.tasksPluginEmoji.doneDate.render("2026-08-04")).toBe(
      " ✅ 2026-08-04",
    );
  });

  it("renders emoji cancelled date", () => {
    expect(
      FIELD_SYNTAX.tasksPluginEmoji.cancelledDate.render("2026-08-04"),
    ).toBe(" ❌ 2026-08-04");
  });

  it("renders dataview done date with exactly two leading spaces", () => {
    expect(FIELD_SYNTAX.dataview.doneDate.render("2026-08-04")).toBe(
      "  [completion:: 2026-08-04]",
    );
  });

  it("renders dataview cancelled date with exactly two leading spaces", () => {
    expect(FIELD_SYNTAX.dataview.cancelledDate.render("2026-08-04")).toBe(
      "  [cancelled:: 2026-08-04]",
    );
  });
});

describe("FIELD_SYNTAX strip", () => {
  describe("tasksPluginEmoji doneDate", () => {
    const strip = FIELD_SYNTAX.tasksPluginEmoji.doneDate.strip;

    it("removes the emoji token", () => {
      expect("Test task ✅ 2026-07-19".replace(strip, "")).toBe("Test task");
    });

    it("removes two occurrences on one line", () => {
      expect("Test task ✅ 2026-07-19 ✅ 2026-07-20".replace(strip, "")).toBe(
        "Test task",
      );
    });

    it("leaves dataview syntax intact", () => {
      const line = "Test task  [completion:: 2026-07-19]";
      expect(line.replace(strip, "")).toBe(line);
    });
  });

  describe("tasksPluginEmoji cancelledDate", () => {
    const strip = FIELD_SYNTAX.tasksPluginEmoji.cancelledDate.strip;

    it("removes the emoji token", () => {
      expect("Test task ❌ 2026-07-19".replace(strip, "")).toBe("Test task");
    });

    it("leaves dataview syntax intact", () => {
      const line = "Test task  [cancelled:: 2026-07-19]";
      expect(line.replace(strip, "")).toBe(line);
    });
  });

  describe("dataview doneDate", () => {
    const strip = FIELD_SYNTAX.dataview.doneDate.strip;

    it("removes the canonical bracket form", () => {
      expect("Test task  [completion:: 2026-07-19]".replace(strip, "")).toBe(
        "Test task",
      );
    });

    it("removes the paren form", () => {
      expect("Test task (completion:: 2026-07-19)".replace(strip, "")).toBe(
        "Test task",
      );
    });

    it("removes the trailing-comma form", () => {
      expect("Test task  [completion:: 2026-07-19],".replace(strip, "")).toBe(
        "Test task",
      );
    });

    it("removes loose whitespace inside the brackets (around the value)", () => {
      expect("Test task  [completion::  2026-07-19 ]".replace(strip, "")).toBe(
        "Test task",
      );
    });

    it("does not match whitespace before '::' and leaves the line untouched", () => {
      const line = "Test task  [ completion ::  2026-07-19 ]";
      expect(line.replace(strip, "")).toBe(line);
    });

    it("removes two occurrences on one line", () => {
      expect(
        "Test task  [completion:: 2026-07-19]  [completion:: 2026-07-20]".replace(
          strip,
          "",
        ),
      ).toBe("Test task");
    });

    it("leaves emoji syntax intact", () => {
      const line = "Test task ✅ 2026-07-19";
      expect(line.replace(strip, "")).toBe(line);
    });
  });

  describe("dataview cancelledDate", () => {
    const strip = FIELD_SYNTAX.dataview.cancelledDate.strip;

    it("removes the canonical bracket form", () => {
      expect("Test task  [cancelled:: 2026-07-19]".replace(strip, "")).toBe(
        "Test task",
      );
    });

    it("removes the paren form", () => {
      expect("Test task (cancelled:: 2026-07-19)".replace(strip, "")).toBe(
        "Test task",
      );
    });

    it("leaves emoji syntax intact", () => {
      const line = "Test task ❌ 2026-07-19";
      expect(line.replace(strip, "")).toBe(line);
    });
  });
});
