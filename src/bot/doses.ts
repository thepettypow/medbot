import type { Bot, Context } from "grammy";
import { config } from "@/lib/config";
import { query } from "@/lib/db";
import { DOSE_SELECT, refreshMessage } from "@/engine/messages";
import { fa } from "@/i18n/fa";
import type { DoseRow } from "@/engine/types";

/**
 * Dose buttons. Ownership: every query joins people.telegram_chat_id = the pressing chat.
 * Concurrency: every state change is `UPDATE ... WHERE status='sent'`, so only the first tap wins.
 */
export function registerDoseCallbacks(bot: Bot<Context>) {
  bot.callbackQuery(/^([tzs]):(\d+)$/, async (ctx) => {
    let toast: string | undefined;
    try {
      const [, kind, idStr] = ctx.match as unknown as string[];
      const id = Number(idStr);
      const chat = ctx.chat?.id;
      const row = chat ? (await query<DoseRow & { telegram_message_id: number }>(
        `${DOSE_SELECT} WHERE d.id=$1 AND p.telegram_chat_id=$2`, [id, chat]))[0] : undefined;
      if (!row) return; // not the owner (or deleted): silently ignore, spinner stops in finally
      const changed = await apply(kind as "t" | "z" | "s", { id });
      toast = changed ? fa.recorded : (kind === "z" && row.status === "sent" ? fa.snoozeLimit : fa.alreadyRecorded);
      const mid = (await query<{ m: number }>(`SELECT telegram_message_id AS m FROM dose_events WHERE id=$1`, [id]))[0]?.m;
      if (mid) await refreshMessage(ctx.api as any, row.person_id, mid);
    } finally {
      await ctx.answerCallbackQuery({ text: toast }).catch(() => {});
    }
  });

  bot.callbackQuery("at", async (ctx) => {
    let toast: string | undefined;
    try {
      const chat = ctx.chat?.id;
      const mid = ctx.callbackQuery.message?.message_id;
      if (!chat || !mid) return;
      const person = (await query<{ id: string }>(`SELECT id FROM people WHERE telegram_chat_id=$1`, [chat]))[0];
      if (!person) return;
      const rows = await query(
        `UPDATE dose_events SET status='taken', responded_at=now()
         WHERE person_id=$1 AND telegram_message_id=$2 AND status='sent' RETURNING id`, [person.id, mid]);
      toast = rows.length ? fa.recorded : fa.alreadyRecorded;
      await refreshMessage(ctx.api as any, person.id, mid);
    } finally {
      await ctx.answerCallbackQuery({ text: toast }).catch(() => {});
    }
  });
}

async function apply(kind: "t" | "z" | "s", { id }: { id: number }): Promise<boolean> {
  if (kind === "t") {
    return (await query(`UPDATE dose_events SET status='taken', responded_at=now() WHERE id=$1 AND status='sent' RETURNING id`, [id])).length > 0;
  }
  if (kind === "s") {
    return (await query(`UPDATE dose_events SET status='skipped', responded_at=now() WHERE id=$1 AND status='sent' RETURNING id`, [id])).length > 0;
  }
  return (await query(
    `UPDATE dose_events SET status='snoozed', snooze_count=snooze_count+1, responded_at=now(),
            snooze_until = now() + make_interval(mins => $2)
     WHERE id=$1 AND status='sent' AND snooze_count < $3 RETURNING id`,
    [id, config.snoozeMin, config.maxSnoozes])).length > 0;
}
