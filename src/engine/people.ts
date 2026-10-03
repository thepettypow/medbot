import { query } from "@/lib/db";
import { fa } from "@/i18n/fa";
import { OPEN_STATUSES, type TgApi } from "./types";
import { refreshMessage } from "./messages";

/** Cancel all unanswered doses of a person and strip buttons from their messages. */
export async function cancelOpenDoses(api: TgApi | null, personId: string) {
  const rows = await query<{ telegram_message_id: number | null }>(
    `UPDATE dose_events SET status='cancelled', responded_at=now(), snooze_until=NULL
     WHERE person_id=$1 AND status = ANY($2) RETURNING telegram_message_id`,
    [personId, OPEN_STATUSES],
  );
  if (!api) return;
  const ids = [...new Set(rows.map((r) => r.telegram_message_id).filter((x): x is number => !!x))];
  for (const id of ids) await refreshMessage(api, personId, id).catch(() => {});
}

/** Telegram said 403 / my_chat_member=kicked: stop reminders and tell the admin. */
export async function markBlocked(api: TgApi, personId: string) {
  const r = await query<{ display_name: string; admin: number }>(
    `UPDATE people SET
        resume_status = CASE WHEN status IN ('active','paused','connected') THEN status ELSE resume_status END,
        status='blocked', updated_at=now()
     WHERE id=$1 AND status <> 'blocked'
     RETURNING display_name, created_by_admin_chat_id AS admin`,
    [personId],
  );
  if (!r[0]) return;
  await cancelOpenDoses(null, personId);
  await api.sendMessage(r[0].admin, fa.notifyBlocked(r[0].display_name), { parse_mode: "HTML" }).catch(() => {});
}

export const isBlockedError = (e: any) =>
  e?.error_code === 403 || /bot was blocked|user is deactivated|chat not found/i.test(String(e?.description ?? ""));

/** Patient pressed Start again / unblocked the bot: restore what they had before. */
export async function unblock(api: TgApi, personId: string) {
  const r = await query<{ telegram_chat_id: number; status: string }>(
    `UPDATE people SET
        status = COALESCE(resume_status, 'connected'),
        active_since = CASE WHEN COALESCE(resume_status,'connected')='active' THEN now() ELSE active_since END,
        resume_status = NULL, updated_at = now()
     WHERE id=$1 AND status='blocked' RETURNING telegram_chat_id, status`,
    [personId],
  );
  if (r[0]?.status === "active") {
    await api.sendMessage(r[0].telegram_chat_id, fa.welcomeBackUnblocked).catch(() => {});
  }
}
