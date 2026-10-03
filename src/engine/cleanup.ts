import { config } from "@/lib/config";
import { kvGet, kvSet, query } from "@/lib/db";
import { fa } from "@/i18n/fa";
import { expireMedications, markMissed } from "./remind";
import type { TgApi } from "./types";

export async function runCleanup(api: TgApi, now = new Date()) {
  const invites = await query(`DELETE FROM invites WHERE (expires_at < now() - interval '7 days') OR (used_at < now() - interval '7 days') OR (revoked_at < now() - interval '7 days') RETURNING id`);
  const flows = await query(`DELETE FROM admin_state WHERE updated_at < now() - make_interval(mins => $1) RETURNING chat_id`, [config.flowTtlMin]);
  await expireMedications();
  const missed = await markMissed(api, now);
  // Doses whose send never succeeded and are long past are system-missed, not silently pending.
  const dead = await query(
    `UPDATE dose_events SET status='missed_system'
     WHERE status IN ('pending','send_failed') AND scheduled_for < $1::timestamptz - make_interval(mins => $2)
     RETURNING id`,
    [now, config.retryWindowMin + 30],
  );

  // Alert admins if the reminder cron went quiet while people have reminders on.
  const active = await query<{ n: number }>(`SELECT count(*)::int AS n FROM people WHERE status='active'`);
  let alerted = false;
  if (active[0].n > 0) {
    const last = await kvGet<{ at: string }>("last_cron");
    const quietMin = last ? (+now - +new Date(last.value.at)) / 60000 : Infinity;
    const lastAlert = await kvGet<{ at: string }>("cron_alert");
    const throttled = lastAlert && +now - +new Date(lastAlert.value.at) < 3 * 3600_000;
    if (quietMin > 15 && !throttled) {
      for (const id of config.adminChatIds) {
        await api.sendMessage(id, fa.notifyCronQuiet(Math.min(Math.round(quietMin), 99999))).catch(() => {});
      }
      await kvSet("cron_alert", { at: now.toISOString() });
      alerted = true;
    }
  }
  return { invites: invites.length, flows: flows.length, missed, dead: dead.length, alerted };
}
