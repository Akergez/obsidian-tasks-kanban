// Stub for the obsidian module during tests.
// The real module is provided by the Obsidian runtime.
import { parse as parseYamlImpl, stringify as stringifyYamlImpl } from "yaml";

export class Plugin {}
export class ItemView {}
export class WorkspaceLeaf {}
export class Notice {}
export class App {
  vault = {
    read: async () => "",
    write: async () => {},
    getAbstractFileByPath: () => null,
  };
  workspace = { getLeaf: () => ({ openFile: async () => {} }) };
  metadataCache = {};
}
export class Vault {}
export class Workspace {}
export class MetadataCache {}
export class TFile {}
export class TFolder {}
export abstract class TextFileView extends ItemView {}
export function setTooltip() {}

/**
 * Obsidian's context menu, reduced to what the cards use: items with a title
 * and a click handler, shown at a mouse event. Tests read `lastMenu` to see
 * what a card offered and to click one of its items.
 */
export class MenuItem {
  title = "";
  icon: string | null = null;
  clickHandler: (() => void) | null = null;
  setTitle(title: string): this {
    this.title = title;
    return this;
  }
  setIcon(icon: string): this {
    this.icon = icon;
    return this;
  }
  onClick(handler: () => void): this {
    this.clickHandler = handler;
    return this;
  }
}

export class Menu {
  static lastMenu: Menu | null = null;
  items: MenuItem[] = [];
  shownAt: unknown = null;
  constructor() {
    Menu.lastMenu = this;
  }
  addItem(build: (item: MenuItem) => unknown): this {
    const item = new MenuItem();
    build(item);
    this.items.push(item);
    return this;
  }
  showAtMouseEvent(event: unknown): this {
    this.shownAt = event;
    return this;
  }
}

/** Obsidian's normalizePath: forward slashes, no repeats, no leading/trailing. */
export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .trim()
    .normalize("NFC");
}

// Obsidian's YAML helpers are backed by the same library the app uses, so tests
// exercise real parsing rather than a hand-rolled approximation.
export function parseYaml(input: string): unknown {
  return parseYamlImpl(input);
}
export function stringifyYaml(value: unknown): string {
  return stringifyYamlImpl(value);
}
