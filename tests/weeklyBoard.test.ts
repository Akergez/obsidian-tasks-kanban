import { describe, it, expect } from "vitest";
import {
  WEEKDAY_TITLES,
  addWeeks,
  isoWeekName,
  renderWeek,
  startOfWeek,
  weekColumns,
  weekDays,
  weekRange,
  weekTag,
  weekVariables,
} from "../src/utils/weeklyBoard";

/** A local-midnight Date for a `YYYY-MM-DD` day. */
function day(iso: string): Date {
  const [year, month, date] = iso.split("-").map(Number);
  return new Date(year, month - 1, date);
}

describe("startOfWeek", () => {
  it("returns the Monday of that week", () => {
    // 2026-08-26 is a Wednesday.
    expect(startOfWeek(day("2026-08-26"))).toEqual(day("2026-08-24"));
  });

  it("is a no-op on a Monday", () => {
    expect(startOfWeek(day("2026-08-24"))).toEqual(day("2026-08-24"));
  });

  it("puts Sunday in the week that just ended, not the one starting", () => {
    // The Monday-start rule: 2026-08-30 is a Sunday.
    expect(startOfWeek(day("2026-08-30"))).toEqual(day("2026-08-24"));
  });

  it("crosses a month and a year boundary", () => {
    expect(startOfWeek(day("2026-01-01"))).toEqual(day("2025-12-29"));
  });

  it("drops the time of day", () => {
    expect(startOfWeek(new Date(2026, 7, 26, 23, 45))).toEqual(
      day("2026-08-24"),
    );
  });
});

describe("isoWeekName", () => {
  it("names an ordinary week", () => {
    expect(isoWeekName(day("2026-08-24"))).toBe("2026-W35");
  });

  it("zero-pads a single-digit week", () => {
    expect(isoWeekName(day("2026-01-05"))).toBe("2026-W02");
  });

  it("gives a January week to the year its Thursday is in", () => {
    // 2026-01-01 is a Thursday, so its week is 2026-W01 — and that week
    // started back in December.
    expect(isoWeekName(day("2025-12-29"))).toBe("2026-W01");
  });

  it("gives a January week to the previous year when it belongs there", () => {
    // 2027-01-01 is a Friday, so its week is still 2026-W53.
    expect(isoWeekName(startOfWeek(day("2027-01-01")))).toBe("2026-W53");
  });

  it("agrees with ISO on a 53-week year", () => {
    expect(isoWeekName(day("2026-12-28"))).toBe("2026-W53");
  });

  it("names consecutive weeks consecutively across a whole year", () => {
    let monday = startOfWeek(day("2026-01-15"));
    const seen: string[] = [];
    for (let i = 0; i < 52; i += 1) {
      seen.push(isoWeekName(monday));
      monday = new Date(
        monday.getFullYear(),
        monday.getMonth(),
        monday.getDate() + 7,
      );
    }
    expect(new Set(seen).size).toBe(52);
  });
});

describe("weekDays", () => {
  it("lists the seven days from Monday", () => {
    expect(weekDays(day("2026-08-24"))).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
    ]);
  });

  it("rolls over a month end", () => {
    expect(weekDays(day("2026-08-31"))).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
  });
});

describe("weekTag", () => {
  it("names the ISO week, unpadded, year last", () => {
    expect(weekTag(day("2026-08-24"))).toBe("#w35_2026");
  });

  it("does not pad a single-digit week", () => {
    expect(weekTag(day("2026-01-26"))).toBe("#w5_2026");
  });

  it("uses the ISO week-year, as the board name does", () => {
    const monday = startOfWeek(day("2027-01-01"));
    expect(isoWeekName(monday)).toBe("2026-W53");
    expect(weekTag(monday)).toBe("#w53_2026");
  });
});

describe("weekVariables", () => {
  const vars = weekVariables(day("2026-08-24"));

  it("gives the week in both spellings, plus its ISO year", () => {
    expect(vars.week).toBe("35");
    expect(vars.ww).toBe("35");
    expect(vars.year).toBe("2026");
  });

  it("pads only the ww spelling", () => {
    const early = weekVariables(day("2026-01-26"));
    expect(early.week).toBe("5");
    expect(early.ww).toBe("05");
  });

  it("names the seven days from Monday", () => {
    expect(vars.monday).toBe("2026-08-24");
    expect(vars.sunday).toBe("2026-08-30");
    expect(vars.nextMonday).toBe("2026-08-31");
  });

  it("gives the neighbouring weeks their own number and year", () => {
    expect(vars.nextWeek).toBe("36");
    expect(vars.nextYear).toBe("2026");
    expect(vars.prevWeek).toBe("34");
    expect(vars.prevYear).toBe("2026");
  });

  it("carries the year boundary, which arithmetic on {{week}} would not", () => {
    const last = weekVariables(startOfWeek(day("2026-12-28")));
    expect(last.week).toBe("53");
    expect(last.year).toBe("2026");
    expect(last.nextWeek).toBe("1");
    expect(last.nextYear).toBe("2027");
  });

  it("carries it backwards too", () => {
    const first = weekVariables(startOfWeek(day("2027-01-04")));
    expect(first.week).toBe("1");
    expect(first.year).toBe("2027");
    expect(first.prevWeek).toBe("53");
    expect(first.prevYear).toBe("2026");
  });
});

describe("addWeeks", () => {
  it("steps forward and back a week at a time", () => {
    expect(addWeeks(day("2026-08-24"), 1)).toEqual(day("2026-08-31"));
    expect(addWeeks(day("2026-08-24"), -1)).toEqual(day("2026-08-17"));
    expect(addWeeks(day("2026-08-24"), 0)).toEqual(day("2026-08-24"));
  });

  it("crosses a year boundary", () => {
    expect(addWeeks(day("2026-12-28"), 1)).toEqual(day("2027-01-04"));
  });

  it("stays on a Monday however far it goes", () => {
    for (const count of [-30, -1, 5, 40]) {
      expect(addWeeks(day("2026-08-24"), count).getDay()).toBe(1);
    }
  });
});

describe("weekColumns", () => {
  const columns = weekColumns(day("2026-08-24"));

  it("is the seven days of that week, Monday first", () => {
    expect(columns.map((c) => c.date)).toEqual(weekDays(day("2026-08-24")));
  });

  it("titles a column with its weekday and its date", () => {
    expect(columns[0].title).toBe("Monday 24 Aug");
    expect(columns[6].title).toBe("Sunday 30 Aug");
  });

  it("keys columns by weekday, not by date, so a fold survives paging", () => {
    const next = weekColumns(day("2026-08-31"));
    expect(columns.map((c) => c.id)).toEqual(next.map((c) => c.id));
    expect(columns[5].id).toBe("week:saturday");
  });
});

describe("weekRange", () => {
  it("spells the week out as a span of days", () => {
    expect(weekRange(day("2026-08-24"))).toBe("24 Aug – 30 Aug 2026");
  });

  it("spans a month, and a year, when the week does", () => {
    expect(weekRange(day("2026-12-28"))).toBe("28 Dec – 3 Jan 2027");
  });
});

describe("renderWeek", () => {
  it("substitutes a week's values into a templated field", () => {
    expect(
      renderWeek("remove tag #w{{week}}_{{year}}", day("2026-08-24")),
    ).toBe("remove tag #w35_2026");
  });

  it("leaves a regex the template language does not own alone", () => {
    const filter = String.raw`tag regex matches /^#w0*{{week}}_{{year}}$/ OR NOT (tag regex matches /^#w\d+_\d{4}$/)`;
    expect(renderWeek(filter, day("2026-01-26"))).toBe(
      String.raw`tag regex matches /^#w0*5_2026$/ OR NOT (tag regex matches /^#w\d+_\d{4}$/)`,
    );
  });
});
