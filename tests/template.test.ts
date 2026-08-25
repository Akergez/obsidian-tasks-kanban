import { describe, it, expect } from "vitest";
import { renderTemplate, templateVariables } from "../src/query/template";

describe("renderTemplate", () => {
  it("substitutes what it knows", () => {
    const { text, errors } = renderTemplate("week {{week}} of {{year}}", {
      week: "35",
      year: "2026",
    });
    expect(text).toBe("week 35 of 2026");
    expect(errors).toEqual([]);
  });

  it("leaves an unknown placeholder standing, and says so", () => {
    const { text, errors } = renderTemplate("{{mondey}}", { monday: "x" });
    expect(text).toBe("{{mondey}}");
    expect(errors).toEqual([
      "Unknown template variable {{mondey}} (available: monday)",
    ]);
  });

  it("reports each unknown name once", () => {
    const { errors } = renderTemplate("{{a}} {{a}} {{b}}", {});
    expect(errors).toHaveLength(2);
  });

  it("leaves a regex quantifier alone — {4} is not a placeholder", () => {
    const { text, errors } = renderTemplate(String.raw`/^#w\d+_\d{4}$/`, {});
    expect(text).toBe(String.raw`/^#w\d+_\d{4}$/`);
    expect(errors).toEqual([]);
  });

  it("does not re-scan what it substituted", () => {
    const { text } = renderTemplate("{{a}}", { a: "{{b}}", b: "no" });
    expect(text).toBe("{{b}}");
  });

  it("lists the placeholders a template uses", () => {
    expect(templateVariables("{{monday}} {{week}} {{monday}}")).toEqual([
      "monday",
      "week",
    ]);
  });
});
