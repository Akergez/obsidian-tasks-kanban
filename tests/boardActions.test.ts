import { describe, it, expect } from "vitest";
import {
  boardActionErrors,
  buildBoardActions,
  UNNAMED_ACTION_TITLE,
} from "../src/utils/boardActions";

const done = { id: "a1", title: "Done", mutation: "set done" };

describe("buildBoardActions", () => {
  it("parses each action's mutation", () => {
    expect(buildBoardActions([done])).toEqual([
      {
        id: "a1",
        title: "Done",
        mutation: [{ kind: "status-done", done: true }],
      },
    ]);
  });

  it("labels an unnamed action rather than showing a blank menu item", () => {
    const [action] = buildBoardActions([{ ...done, title: "  " }]);
    expect(action.title).toBe(UNNAMED_ACTION_TITLE);
  });

  it("drops an action that would do nothing", () => {
    expect(buildBoardActions([{ ...done, mutation: "" }])).toEqual([]);
    expect(buildBoardActions([{ ...done, mutation: "burn it" }])).toEqual([]);
  });

  it("keeps the configured order — it is the menu order", () => {
    const actions = buildBoardActions([
      done,
      { id: "a2", title: "Cancel", mutation: "set status.type CANCELLED" },
    ]);
    expect(actions.map((a) => a.title)).toEqual(["Done", "Cancel"]);
  });
});

describe("boardActionErrors", () => {
  it("says nothing about a usable action", () => {
    expect(boardActionErrors([done])).toEqual([]);
  });

  it("flags an action with no instruction", () => {
    expect(boardActionErrors([{ ...done, mutation: "" }])).toEqual([
      "Done: needs at least one instruction.",
    ]);
  });

  it("names the action a bad line belongs to", () => {
    const errors = boardActionErrors([
      { ...done, mutation: "burn it" },
      { ...done, title: "", mutation: "set scheduled soon" },
    ]);
    expect(errors[0]).toContain("Done:");
    expect(errors[1]).toContain("Action 2:");
  });
});
