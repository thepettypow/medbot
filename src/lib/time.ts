import { DateTime } from "luxon";

const FA = "۰۱۲۳۴۵۶۷۸۹";
const AR = "٠١٢٣٤٥٦٧٨٩";

/** Persian/Arabic-Indic digits -> ASCII, so admins can type in either. */
export function normDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (d) => String(FA.indexOf(d))).replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)));
}
export const toFa = (s: string | number) => String(s).replace(/\d/g, (d) => FA[Number(d)]);

/** '8' | '8:30' | '0830' | '830' | '08:30' -> '08:30', or null if invalid. */
export function parseTime(input: string): string | null {
  const s = normDigits(input).trim();
  let h: number, m: number;
  let r: RegExpMatchArray | null;
  if ((r = s.match(/^(\d{1,2})[:.](\d{1,2})$/))) { h = +r[1]; m = +r[2]; }
  else if ((r = s.match(/^(\d{1,2})$/))) { h = +r[1]; m = 0; }
  else if ((r = s.match(/^(\d{1,2})(\d{2})$/))) { h = +r[1]; m = +r[2]; }
  else return null;
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Several times separated by space/comma/Persian comma. Returns sorted unique list or null. */
export function parseTimes(input: string): string[] | null {
  const parts = normDigits(input).split(/[\s,،;]+/).filter(Boolean);
  if (!parts.length) return null;
  const out = new Set<string>();
  for (const p of parts) {
    const t = parseTime(p);
    if (!t) return null;
    out.add(t);
  }
  return [...out].sort();
}

export function parseDate(input: string): string | null {
  const s = normDigits(input).trim().replace(/[/.]/g, "-");
  const r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!r) return null;
  const d = DateTime.fromObject({ year: +r[1], month: +r[2], day: +r[3] }, { zone: "utc" });
  return d.isValid ? d.toISODate() : null;
}

export const isValidZone = (z: string) => DateTime.local().setZone(z).isValid;

/** 0=Sunday..6=Saturday (luxon: Mon=1..Sun=7). */
export const dow = (d: DateTime) => d.weekday % 7;

export interface TimeSlot {
  medicationTimeId: number;
  medicationId: number;
  localTime: string;       // 'HH:MM' or 'HH:MM:SS'
  daysOfWeek: number[];
  startDate: string;       // YYYY-MM-DD
  endDate: string | null;
}

/**
 * All instants in (from, to] at which `slot` fires for a person in `zone`.
 * The local wall-clock time is the source of truth, so 08:00 stays 08:00 across DST.
 * Luxon moves a time in a spring-forward gap to the next valid instant and picks the
 * first occurrence of a repeated autumn hour, so each local slot yields exactly one instant.
 */
export function occurrences(slot: TimeSlot, zone: string, from: Date, to: Date): Date[] {
  const [hh, mm] = slot.localTime.split(":").map(Number);
  const start = DateTime.fromJSDate(from, { zone }).startOf("day").minus({ days: 1 });
  const end = DateTime.fromJSDate(to, { zone }).startOf("day");
  const out: Date[] = [];
  for (let d = start; d <= end; d = d.plus({ days: 1 })) {
    const day = d.toISODate()!;
    if (day < slot.startDate) continue;
    if (slot.endDate && day > slot.endDate) continue;
    if (!slot.daysOfWeek.includes(dow(d))) continue;
    const at = DateTime.fromObject({ year: d.year, month: d.month, day: d.day, hour: hh, minute: mm }, { zone });
    const js = at.toJSDate();
    if (js > from && js <= to) out.push(js);
  }
  return out;
}

export const fmtLocal = (d: Date, zone: string) =>
  toFa(DateTime.fromJSDate(d, { zone }).toFormat("HH:mm"));
