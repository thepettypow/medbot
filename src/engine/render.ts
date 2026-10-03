import { InlineKeyboard } from "grammy";
import { config } from "@/lib/config";
import { fmtLocal } from "@/lib/time";
import { fa } from "@/i18n/fa";
import type { DoseRow } from "./types";

// callback_data: "t:<id>" taken, "z:<id>" snooze, "s:<id>" skip, "at" all taken. All << 64 bytes.
export const cb = {
  taken: (id: number) => `t:${id}`,
  snooze: (id: number) => `z:${id}`,
  skip: (id: number) => `s:${id}`,
  allTaken: "at",
};

export function renderReminder(rows: DoseRow[]): { text: string; reply_markup?: InlineKeyboard } {
  const tz = rows[0].timezone;
  const lines: string[] = [fa.remindTitle];
  for (const r of rows) {
    lines.push(fa.remindLine(r.name, r.dose));
    if (r.note) lines.push(fa.noteLine(r.note));
    const st = statusSuffix(r, tz);
    if (st) lines.push(st);
  }
  const open = rows.filter((r) => r.status === "sent");
  let kb: InlineKeyboard | undefined;
  if (open.length) {
    const k = (kb = new InlineKeyboard());
    const canSnooze = (r: DoseRow) => r.snooze_count < config.maxSnoozes;
    if (rows.length === 1) {
      const r = open[0];
      k.text(fa.btnTaken, cb.taken(r.id));
      if (canSnooze(r)) k.text(fa.btnSnooze(config.snoozeMin), cb.snooze(r.id));
      k.text(fa.btnSkip, cb.skip(r.id));
    } else {
      if (open.length > 1) k.text(fa.btnTakenAll, cb.allTaken).row();
      open.forEach((r, i) => {
        if (i > 0) k.row();
        k.text(fa.btnTakenOne(r.name.slice(0, 18)), cb.taken(r.id));
        if (canSnooze(r)) k.text("⏰", cb.snooze(r.id));
        k.text("✗", cb.skip(r.id));
      });
    }
  }
  return { text: lines.join("\n"), reply_markup: kb };
}

function statusSuffix(r: DoseRow, tz: string): string {
  switch (r.status) {
    case "taken": return fa.stTaken(r.responded_at ? fmtLocal(r.responded_at, tz) : "");
    case "skipped": return fa.stSkipped;
    case "snoozed": return fa.stSnoozed(r.snooze_until ? fmtLocal(r.snooze_until, tz) : "");
    case "missed": case "missed_system": return fa.stMissed;
    case "cancelled": return fa.stCancelled;
    default: return "";
  }
}
