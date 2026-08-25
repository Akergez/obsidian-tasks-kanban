import { vi } from "vitest";
import { parse as parseYamlImpl, stringify as stringifyYamlImpl } from "yaml";

// Mock Obsidian API.
// This factory — not tests/__mocks__/obsidian.ts — is what tests actually get:
// it overrides the module alias. Keep the two in step when adding an export.
//
// parseYaml/stringifyYaml delegate to the real `yaml` package rather than a
// stub, so the board-file format is exercised against a genuine YAML parser.
/**
 * Obsidian's context menu, reduced to what the cards use. `Menu.lastMenu` is
 * how a test reads back what a card offered on right-click.
 */
class MenuItemStub {
  title = "";
  icon: string | null = null;
  clickHandler: (() => void) | null = null;
  setTitle(title: string) {
    this.title = title;
    return this;
  }
  setIcon(icon: string) {
    this.icon = icon;
    return this;
  }
  onClick(handler: () => void) {
    this.clickHandler = handler;
    return this;
  }
}

class MenuStub {
  static lastMenu: MenuStub | null = null;
  items: MenuItemStub[] = [];
  shownAt: unknown = null;
  constructor() {
    MenuStub.lastMenu = this;
  }
  addItem(build: (item: MenuItemStub) => unknown) {
    const item = new MenuItemStub();
    build(item);
    this.items.push(item);
    return this;
  }
  showAtMouseEvent(event: unknown) {
    this.shownAt = event;
    return this;
  }
}

vi.mock("obsidian", () => ({
  Plugin: class {},
  ItemView: class {},
  TextFileView: class {},
  WorkspaceLeaf: class {},
  Notice: class {},
  App: class {},
  Vault: class {},
  Workspace: class {},
  MetadataCache: class {},
  TFile: class {},
  TFolder: class {},
  setTooltip: vi.fn(),
  Menu: MenuStub,
  normalizePath: (path: string) => normalizePathImpl(path),
  parseYaml: (input: string) => parseYamlImpl(input),
  stringifyYaml: (value: unknown) => stringifyYamlImpl(value),
}));

/** Obsidian's normalizePath: forward slashes, no repeats, no leading/trailing. */
function normalizePathImpl(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .trim()
    .normalize("NFC");
}

// Apply polyfills directly to the prototype so every element gets them.
const proto = HTMLElement.prototype as Record<string, unknown>;
if (!proto.empty) {
  proto.empty = function empty() {
    while (this.firstChild) this.removeChild(this.firstChild);
  } as () => void;
}
if (!proto.addClass) {
  proto.addClass = function addClass(cls: string) {
    this.classList.add(cls);
  } as (cls: string) => void;
}
if (!proto.removeClass) {
  proto.removeClass = function removeClass(cls: string) {
    this.classList.remove(cls);
  } as (cls: string) => void;
}
if (!proto.toggleClass) {
  proto.toggleClass = function toggleClass(cls: string, force?: boolean) {
    this.classList.toggle(cls, force);
  } as (cls: string, force?: boolean) => void;
}
if (!proto.setText) {
  proto.setText = function setText(text: string) {
    this.textContent = text;
  } as (text: string) => void;
}
if (!proto.createDiv) {
  proto.createDiv = function createDiv(opts?: {
    cls?: string;
    text?: string;
  }): HTMLDivElement {
    const div = document.createElement("div");
    if (opts?.cls) div.className = opts.cls;
    if (opts?.text) div.textContent = opts.text;
    this.appendChild(div);
    return div;
  } as (opts?: { cls?: string; text?: string }) => HTMLDivElement;
}
if (!proto.createSpan) {
  proto.createSpan = function createSpan(opts?: {
    cls?: string;
    text?: string;
  }): HTMLSpanElement {
    const span = document.createElement("span");
    if (opts?.cls) span.className = opts.cls;
    if (opts?.text) span.textContent = opts.text;
    this.appendChild(span);
    return span;
  } as (opts?: { cls?: string; text?: string }) => HTMLSpanElement;
}

// Global test setup
afterEach(() => {
  vi.clearAllMocks();
});
