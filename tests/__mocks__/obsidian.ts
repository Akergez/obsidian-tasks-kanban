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

// Obsidian's YAML helpers are backed by the same library the app uses, so tests
// exercise real parsing rather than a hand-rolled approximation.
export function parseYaml(input: string): unknown {
  return parseYamlImpl(input);
}
export function stringifyYaml(value: unknown): string {
  return stringifyYamlImpl(value);
}
