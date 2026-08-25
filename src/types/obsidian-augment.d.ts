import type { EventRef } from "obsidian";
import type { TasksCacheUpdateData } from "../services/TasksIntegration";

declare module "obsidian" {
  interface App {
    plugins: {
      getPlugin(id: string): unknown;
    };
  }

  interface WorkspaceLeaf {
    /**
     * Redraw the leaf's tab header, picking up a changed `view.icon`. Internal
     * to Obsidian, so every call site treats it as optional.
     */
    updateHeader?(): void;
  }

  interface Workspace {
    on(
      name: "obsidian-tasks-plugin:cache-update",
      callback: (data: TasksCacheUpdateData) => void,
    ): EventRef;
  }
}
