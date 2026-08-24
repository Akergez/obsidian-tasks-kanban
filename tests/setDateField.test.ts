import { describe, it, expect } from "vitest";
import {
  FIELD_SYNTAX,
  resolveTaskFormatSetting,
  setDateField,
  type TaskFormat,
  type WritableDateField,
} from "../src/utils/taskFormat";

const FIELDS: WritableDateField[] = [
  "createdDate",
  "startDate",
  "scheduledDate",
  "dueDate",
  "doneDate",
  "cancelledDate",
];

describe("setDateField", () => {
  describe.each<TaskFormat>(["tasksPluginEmoji", "dataview"])(
    "%s format",
    (format) => {
      it.each(FIELDS)("writes %s onto a bare line", (field) => {
        expect(
          setDateField("- [ ] Write tests", field, "2026-08-24", format),
        ).toBe(
          `- [ ] Write tests${FIELD_SYNTAX[format][field].render("2026-08-24")}`,
        );
      });

      it.each(FIELDS)(
        "replaces an existing %s rather than duplicating",
        (field) => {
          const line = `- [ ] Write tests${FIELD_SYNTAX[format][field].render("2026-01-01")}`;
          expect(setDateField(line, field, "2026-08-24", format)).toBe(
            `- [ ] Write tests${FIELD_SYNTAX[format][field].render("2026-08-24")}`,
          );
        },
      );

      it.each(FIELDS)("removes %s when the date is null", (field) => {
        const line = `- [ ] Write tests${FIELD_SYNTAX[format][field].render("2026-01-01")}`;
        expect(setDateField(line, field, null, format)).toBe(
          "- [ ] Write tests",
        );
      });

      it("leaves the other date fields alone", () => {
        const line = `- [ ] Write tests${FIELD_SYNTAX[format].dueDate.render("2026-01-01")}`;
        const updated = setDateField(
          line,
          "scheduledDate",
          "2026-08-24",
          format,
        );
        expect(updated).toContain(
          FIELD_SYNTAX[format].dueDate.render("2026-01-01").trim(),
        );
        expect(updated).toContain(
          FIELD_SYNTAX[format].scheduledDate.render("2026-08-24").trim(),
        );
      });

      it("keeps a trailing block reference at the end of the line", () => {
        const updated = setDateField(
          "- [ ] Write tests ^task-42",
          "scheduledDate",
          "2026-08-24",
          format,
        );
        expect(updated).toMatch(/\^task-42$/);
        expect(updated).toContain(
          FIELD_SYNTAX[format].scheduledDate.render("2026-08-24").trim(),
        );
      });

      it("keeps tags and text in place", () => {
        const updated = setDateField(
          "- [ ] Write tests #work",
          "dueDate",
          "2026-08-24",
          format,
        );
        expect(updated).toContain("#work");
      });
    },
  );

  it("writes emoji fields the way the Tasks serializer does", () => {
    expect(
      setDateField(
        "- [ ] T",
        "scheduledDate",
        "2026-08-24",
        "tasksPluginEmoji",
      ),
    ).toBe("- [ ] T ⏳ 2026-08-24");
    expect(
      setDateField("- [ ] T", "dueDate", "2026-08-24", "tasksPluginEmoji"),
    ).toBe("- [ ] T 📅 2026-08-24");
    expect(
      setDateField("- [ ] T", "startDate", "2026-08-24", "tasksPluginEmoji"),
    ).toBe("- [ ] T 🛫 2026-08-24");
    expect(
      setDateField("- [ ] T", "createdDate", "2026-08-24", "tasksPluginEmoji"),
    ).toBe("- [ ] T ➕ 2026-08-24");
  });

  it("writes dataview fields with the keys Tasks parses", () => {
    expect(
      setDateField("- [ ] T", "scheduledDate", "2026-08-24", "dataview"),
    ).toBe("- [ ] T  [scheduled:: 2026-08-24]");
    expect(setDateField("- [ ] T", "dueDate", "2026-08-24", "dataview")).toBe(
      "- [ ] T  [due:: 2026-08-24]",
    );
    expect(setDateField("- [ ] T", "doneDate", "2026-08-24", "dataview")).toBe(
      "- [ ] T  [completion:: 2026-08-24]",
    );
  });

  it("strips the alternative emoji spellings Tasks also accepts", () => {
    expect(
      setDateField(
        "- [ ] T ⌛ 2026-01-01",
        "scheduledDate",
        null,
        "tasksPluginEmoji",
      ),
    ).toBe("- [ ] T");
    expect(
      setDateField(
        "- [ ] T 📆 2026-01-01",
        "dueDate",
        null,
        "tasksPluginEmoji",
      ),
    ).toBe("- [ ] T");
    expect(
      setDateField(
        "- [ ] T 🗓️ 2026-01-01",
        "dueDate",
        null,
        "tasksPluginEmoji",
      ),
    ).toBe("- [ ] T");
  });

  it("strips the dataview paren and trailing-comma forms", () => {
    expect(
      setDateField("- [ ] T (due:: 2026-01-01)", "dueDate", null, "dataview"),
    ).toBe("- [ ] T");
    expect(
      setDateField("- [ ] T  [due:: 2026-01-01],", "dueDate", null, "dataview"),
    ).toBe("- [ ] T");
  });

  it("leaves a foreign-format token alone — it is description text", () => {
    // Under Dataview format the Tasks parser never read that emoji as a date.
    expect(
      setDateField("- [ ] T 📅 2026-01-01", "dueDate", null, "dataview"),
    ).toBe("- [ ] T 📅 2026-01-01");
    expect(
      setDateField(
        "- [ ] T [due:: 2026-01-01]",
        "dueDate",
        null,
        "tasksPluginEmoji",
      ),
    ).toBe("- [ ] T [due:: 2026-01-01]");
  });
});

describe("resolveTaskFormatSetting", () => {
  it("keeps the two concrete formats", () => {
    expect(resolveTaskFormatSetting("dataview")).toBe("dataview");
    expect(resolveTaskFormatSetting("tasksPluginEmoji")).toBe(
      "tasksPluginEmoji",
    );
  });

  it("falls back to auto for anything else", () => {
    expect(resolveTaskFormatSetting(undefined)).toBe("auto");
    expect(resolveTaskFormatSetting("auto")).toBe("auto");
    expect(resolveTaskFormatSetting("nonsense")).toBe("auto");
  });
});
