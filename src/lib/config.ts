const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : d;
};

export const config = {
  get botToken() { return need("BOT_TOKEN"); },
  get webhookSecret() { return need("TELEGRAM_WEBHOOK_SECRET"); },
  get cronSecret() { return need("CRON_SECRET"); },
  get databaseUrl() { return need("DATABASE_URL"); },
  get adminChatIds(): number[] {
    return (process.env.ADMIN_CHAT_IDS ?? "").split(",").map((s) => Number(s.trim())).filter(Number.isFinite);
  },
  get defaultTimezone() { return process.env.DEFAULT_TIMEZONE || "Asia/Tehran"; },
  get dueWindowMin() { return num(process.env.DUE_WINDOW_MIN, 10); },
  get staleAfterMin() { return num(process.env.STALE_AFTER_MIN, 10); },
  get staleLookbackMin() { return num(process.env.STALE_LOOKBACK_MIN, 360); },
  get retryWindowMin() { return num(process.env.RETRY_WINDOW_MIN, 15); },
  get missedAfterMin() { return num(process.env.MISSED_AFTER_MIN, 120); },
  get snoozeMin() { return num(process.env.SNOOZE_MIN, 30); },
  get maxSnoozes() { return num(process.env.MAX_SNOOZES, 2); },
  get maxSendAttempts() { return num(process.env.MAX_SEND_ATTEMPTS, 3); },
  get nudgeOffsetsMin(): number[] {
    const raw = process.env.NUDGE_OFFSETS_MIN ?? "15,45";
    return raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  },
  inviteTtlHours: 72,
  flowTtlMin: 30,
  consentVersion: "2026-10-v1",
};

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var ${k}`);
  return v;
}

export const isAdmin = (chatId: number | undefined) =>
  chatId !== undefined && config.adminChatIds.includes(chatId);
