/** The slice of grammY's Api the engine uses; lets tests inject a fake. */
export interface TgApi {
  sendMessage(chatId: number, text: string, other?: Record<string, unknown>): Promise<{ message_id: number }>;
  editMessageText(chatId: number, messageId: number, text: string, other?: Record<string, unknown>): Promise<unknown>;
  editMessageReplyMarkup(chatId: number, messageId: number, other?: Record<string, unknown>): Promise<unknown>;
}

export interface DoseRow {
  id: number;
  status: string;
  responded_at: Date | null;
  snooze_until: Date | null;
  snooze_count: number;
  scheduled_for: Date;
  name: string;
  dose: string;
  note: string | null;
  timezone: string;
  chat_id: number | null;
  person_id: string;
  person_name: string;
  admin_chat_id: number;
}

export const OPEN_STATUSES = ["pending", "sent", "snoozed", "send_failed"];
