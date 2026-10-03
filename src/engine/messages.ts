import { query } from "@/lib/db";
import { renderReminder } from "./render";
import type { DoseRow, TgApi } from "./types";

export const DOSE_SELECT = `
  SELECT d.id, d.status, d.responded_at, d.snooze_until, d.snooze_count, d.scheduled_for,
         m.name, m.dose, m.note, p.timezone, p.telegram_chat_id AS chat_id, p.id AS person_id,
         p.display_name AS person_name, p.created_by_admin_chat_id AS admin_chat_id
  FROM dose_events d
  JOIN medication_times mt ON mt.id = d.medication_time_id
  JOIN medications m ON m.id = mt.medication_id
  JOIN people p ON p.id = d.person_id`;

export const rowsForMessage = (personId: string, messageId: number) =>
  query<DoseRow>(`${DOSE_SELECT} WHERE d.person_id=$1 AND d.telegram_message_id=$2 ORDER BY m.name, d.id`, [personId, messageId]);

/** Re-render a sent reminder from current DB state (buttons only for still-open doses). */
export async function refreshMessage(api: TgApi, personId: string, messageId: number) {
  const rows = await rowsForMessage(personId, messageId);
  if (!rows.length || !rows[0].chat_id) return;
  const { text, reply_markup } = renderReminder(rows);
  try {
    await api.editMessageText(rows[0].chat_id, messageId, text, { parse_mode: "HTML", reply_markup });
  } catch (e: any) {
    // "message is not modified" and deleted messages are harmless.
    if (!/not modified|not found|can't be edited/i.test(String(e?.description ?? e?.message))) throw e;
  }
}
