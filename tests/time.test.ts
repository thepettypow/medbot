import { describe, expect, it } from "vitest";
import { occurrences, parseDate, parseTime, parseTimes, isValidZone, toFa } from "../src/lib/time";

const slot = (t: string, extra = {}) => ({
  medicationTimeId: 1, medicationId: 1, localTime: t,
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startDate: "2026-01-01", endDate: null, ...extra,
});
const iso = (d: Date[]) => d.map((x) => x.toISOString());

describe("parseTime", () => {
  it.each([["8", "08:30".replace("30", "00")], ["8:30", "08:30"], ["0830", "08:30"], ["830", "08:30"],
    ["۸:۳۰", "08:30"], ["20", "20:00"], ["23:59", "23:59"]])("%s", (i, o) => expect(parseTime(i)).toBe(o));
  it.each(["25:99", "24", "8:60", "abc", "", "12:3x"])("rejects %s", (i) => expect(parseTime(i)).toBeNull());
  it("parseTimes sorts and dedupes", () => expect(parseTimes("20, 8 08:00")).toEqual(["08:00", "20:00"]));
  it("parseTimes rejects any bad token", () => expect(parseTimes("8 25:00")).toBeNull());
});

describe("parseDate / zones", () => {
  it("accepts valid", () => expect(parseDate("۲۰۲۶/3/5")).toBe("2026-03-05"));
  it("rejects invalid", () => expect(parseDate("2026-02-30")).toBeNull());
  it("Asia/Tehran is valid, Iran/Tehran is not", () => {
    expect(isValidZone("Asia/Tehran")).toBe(true);
    expect(isValidZone("Iran/Tehran")).toBe(false);
  });
  it("toFa", () => expect(toFa("08:30")).toBe("۰۸:۳۰"));
});

describe("occurrences (DST)", () => {
  it("08:00 Rome is 07:00Z in winter and 06:00Z in summer", () => {
    const w = occurrences(slot("08:00"), "Europe/Rome", new Date("2026-01-10T00:00:00Z"), new Date("2026-01-10T23:59:00Z"));
    const s = occurrences(slot("08:00"), "Europe/Rome", new Date("2026-07-10T00:00:00Z"), new Date("2026-07-10T23:59:00Z"));
    expect(iso(w)).toEqual(["2026-01-10T07:00:00.000Z"]);
    expect(iso(s)).toEqual(["2026-07-10T06:00:00.000Z"]);
  });
  it("spring-forward gap: 02:30 on 2026-03-29 Rome fires once, moved to the next valid time", () => {
    const r = occurrences(slot("02:30"), "Europe/Rome", new Date("2026-03-28T20:00:00Z"), new Date("2026-03-29T20:00:00Z"));
    expect(r).toHaveLength(1);
    expect(iso(r)[0]).toBe("2026-03-29T01:30:00.000Z"); // = 03:30 CEST
  });
  it("autumn repeated hour: 02:30 on 2026-10-25 Rome fires exactly once", () => {
    const r = occurrences(slot("02:30"), "Europe/Rome", new Date("2026-10-24T20:00:00Z"), new Date("2026-10-25T20:00:00Z"));
    expect(r).toHaveLength(1);
  });
  it("Tehran has no DST: 08:00 is always 04:30Z", () => {
    for (const day of ["2026-01-15", "2026-07-15"]) {
      const r = occurrences(slot("08:00"), "Asia/Tehran", new Date(`${day}T00:00:00Z`), new Date(`${day}T23:59:00Z`));
      expect(iso(r)).toEqual([`${day}T04:30:00.000Z`]);
    }
  });
  it("respects weekdays, start and end dates", () => {
    // 2026-01-12 is a Monday (dow 1)
    const mon = slot("08:00", { daysOfWeek: [1] });
    const f = new Date("2026-01-11T00:00:00Z"), t = new Date("2026-01-14T00:00:00Z");
    expect(occurrences(mon, "UTC", f, t)).toHaveLength(1);
    expect(occurrences(slot("08:00", { startDate: "2026-01-13" }), "UTC", f, t)).toHaveLength(1);
    expect(occurrences(slot("08:00", { endDate: "2026-01-10" }), "UTC", f, t)).toHaveLength(0);
    expect(occurrences(slot("08:00", { endDate: "2026-01-11" }), "UTC", f, t)).toHaveLength(1);
  });
  it("window is (from, to]: boundary semantics", () => {
    const at = new Date("2026-01-10T08:00:00Z");
    expect(occurrences(slot("08:00"), "UTC", at, new Date(at.getTime() + 60000))).toHaveLength(0);
    expect(occurrences(slot("08:00"), "UTC", new Date(at.getTime() - 1), at)).toHaveLength(1);
  });
  it("local day differing from UTC day is found (Tehran 00:30 = 21:00Z previous day)", () => {
    const r = occurrences(slot("00:30"), "Asia/Tehran", new Date("2026-01-14T20:00:00Z"), new Date("2026-01-14T22:00:00Z"));
    expect(iso(r)).toEqual(["2026-01-14T21:00:00.000Z"]);
  });
});
