import { describe, it, expect, vi } from "vitest";
import { TasksIntegration } from "../src/services/TasksIntegration";
import type { TaskFormatSetting } from "../src/utils/taskFormat";

/**
 * A minimal App whose Tasks plugin reports `taskFormat`, plus a data.json read
 * that always fails — so the in-memory branch is the one under test unless the
 * plugin is absent.
 */
function mockApp(tasksSettings: Record<string, unknown> | null) {
  return {
    vault: {
      configDir: "/mock-config",
      adapter: { read: vi.fn().mockRejectedValue(new Error("no file")) },
    },
    workspace: { on: vi.fn(), offref: vi.fn(), trigger: vi.fn() },
    plugins: {
      getPlugin: vi
        .fn()
        .mockReturnValue(
          tasksSettings === null ? null : { settings: tasksSettings },
        ),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function integration(
  tasksSettings: Record<string, unknown> | null,
  setting?: TaskFormatSetting,
) {
  return new TasksIntegration(
    mockApp(tasksSettings),
    setting === undefined ? undefined : () => setting,
  );
}

describe("TasksIntegration.getWriteSettings", () => {
  it("follows the Tasks plugin by default", async () => {
    const tasks = integration({ taskFormat: "dataview" });
    expect((await tasks.getWriteSettings()).taskFormat).toBe("dataview");
  });

  it("follows the Tasks plugin when the setting is auto", async () => {
    const tasks = integration({ taskFormat: "dataview" }, "auto");
    expect((await tasks.getWriteSettings()).taskFormat).toBe("dataview");
  });

  it("lets the plugin's own setting override what Tasks reports", async () => {
    const tasks = integration({ taskFormat: "dataview" }, "tasksPluginEmoji");
    expect((await tasks.getWriteSettings()).taskFormat).toBe(
      "tasksPluginEmoji",
    );
  });

  it("applies the override even when Tasks' settings can't be read", async () => {
    const tasks = integration(null, "dataview");
    expect((await tasks.getWriteSettings()).taskFormat).toBe("dataview");
  });

  it("falls back to emoji when nothing can be read and nothing is pinned", async () => {
    const tasks = integration(null, "auto");
    expect((await tasks.getWriteSettings()).taskFormat).toBe(
      "tasksPluginEmoji",
    );
  });

  it("leaves the done/cancelled-date settings to Tasks", async () => {
    const tasks = integration(
      { taskFormat: "dataview", setDoneDate: true, setCancelledDate: false },
      "tasksPluginEmoji",
    );
    const settings = await tasks.getWriteSettings();
    expect(settings.setDoneDate).toBe(true);
    expect(settings.setCancelledDate).toBe(false);
  });
});
