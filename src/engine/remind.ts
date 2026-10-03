import { config } from "@/lib/config";
import { kvSet, query } from "@/lib/db";
import { occurrences, type TimeSlot } from "@/lib/time";
import { fa } from "@/i18n/fa";
import { DOSE_SELECT, refreshMessage } from "./messages";
import { isBlockedError, markBlocked } from "./people";
import { renderReminder } from "./render";
import type { DoseRow, TgApi } from "./types";

const SEND_GAP_MS = 50; // ~20 msg/s, well under Telegram's ~30/s

export interface RemindStats {
  inserted: number; stale: number; sent: number; failed: number; nudged: number; missed: number;
}

interface SlotRow extends TimeSlot {
  personId: string; zone: string; personName: string; adminChatId: number; notBefore: Date;
}

export async function runRemind(api: TgApi, now = new Date(), sleep = defaultSleep): Promise<RemindStats> {
  const stats: RemindStats = { inserted: 0, stale: 0, sent: 0, failed: 0, nudged: 0, missed: 0 };

  await expireMedications();
  stats.missed = await markMissed(api, now);

  const { due, stale } = await scheduleDoses(now);
  stats.inserted = due.length;
  stats.stale = stale.length;
  await notifyStale(api, stale);

  // Everything we are allowed to send right now: fresh inserts, retries, and finished snoozes.
  const claimed = [...due, ...(await claimRetries(now)), ...(await claimSnoozed(now))];
  const sendStats = await sendGroups(api, claimed, now, sleep);
  stats.sent = sendStats.sent;
  stats.failed = sendStats.failed;

  stats.nudged = await sendNudges(api, now, sleep);
  await kvSet("last_cron", { at: now.toISOString(), ...stats });
  return stats;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Medications past their end date stop sending (the engine also checks per-dose). */
export async function expireMedications() {
  await query(
    `UPDATE medications m SET is_active=false
     FROM people p
     WHERE p.id=m.person_id AND m.is_active AND m.end_date IS NOT NULL
       AND m.end_date < (now() AT TIME ZONE p.timezone)::date`,
  );
}

/** Unanswered after MISSED_AFTER_MIN => missed. Buttons are stripped from the message. */
export async function markMissed(api: TgApi | null, now: Date): Promise<number> {
  const rows = await query<{ person_id: string; telegram_message_id: number }>(
    `UPDATE dose_events SET status='missed'
     WHERE status='sent' AND sent_at < $1::timestamptz - make_interval(mins => $2)
     RETURNING person_id, telegram_message_id`,
    [now, config.missedAfterMin],
  );
  if (api) {
    const seen = new Set<string>();
    for (const r of rows) {
      const k = `${r.person_id}:${r.telegram_message_id}`;
      if (seen.has(k) || !r.telegram_message_id) continue;
      seen.add(k);
      await refreshMessage(api, r.person_id, r.telegram_message_id).catch(() => {});
    }
  }
  return rows.length;
}

async function loadSlots(): Promise<SlotRow[]> {
  const rows = await query(
    `SELECT mt.id AS mt_id, m.id AS med_id, to_char(mt.local_time,'HH24:MI') AS local_time,
            m.days_of_week, m.start_date, m.end_date, mt.created_at AS mt_created,
            p.id AS person_id, p.timezone, p.display_name, p.created_by_admin_chat_id, p.active_since
     FROM people p
     JOIN medications m ON m.person_id=p.id AND m.is_active
     JOIN medication_times mt ON mt.medication_id=m.id AND mt.removed_at IS NULL
     WHERE p.status='active' AND p.telegram_chat_id IS NOT NULL`,
  );
  return rows.map((r: any) => ({
    medicationTimeId: r.mt_id, medicationId: r.med_id, localTime: r.local_time,
    daysOfWeek: r.days_of_week.map(Number), startDate: r.start_date, endDate: r.end_date,
    personId: r.person_id, zone: r.timezone, personName: r.display_name, adminChatId: r.created_by_admin_chat_id,
    // never backfill before the person was started or before this time slot existed
    notBefore: new Date(Math.max(+new Date(r.active_since ?? 0), +new Date(r.mt_created))),
  }));
}

interface Inserted { id: number; person_id: string }

/**
 * Compute due + stale doses and insert them. The UNIQUE (medication_time_id, scheduled_for)
 * constraint is the idempotency gate: only the transaction whose INSERT actually creates the
 * row gets it back from RETURNING, so overlapping crons can never both send the same dose.
 */
async function scheduleDoses(now: Date): Promise<{ due: Inserted[]; stale: (Inserted & { name: string; admin: number })[] }> {
  const slots = await loadSlots();
  const dueFrom = new Date(+now - config.dueWindowMin * 60_000);
  const staleFrom = new Date(+now - config.staleLookbackMin * 60_000);
  const staleTo = new Date(+now - config.staleAfterMin * 60_000);

  const dueArgs: { mt: number; p: string; at: Date }[] = [];
  const staleArgs: typeof dueArgs = [];
  const meta = new Map<string, { name: string; admin: number }>();
  for (const s of slots) {
    meta.set(s.personId, { name: s.personName, admin: s.adminChatId });
    for (const at of occurrences(s, s.zone, dueFrom, now)) if (at > s.notBefore) dueArgs.push({ mt: s.medicationTimeId, p: s.personId, at });
    for (const at of occurrences(s, s.zone, staleFrom, staleTo)) if (at > s.notBefore) staleArgs.push({ mt: s.medicationTimeId, p: s.personId, at });
  }

  const insert = async (args: typeof dueArgs, status: "pending" | "missed_system") => {
    if (!args.length) return [] as Inserted[];
    return query<Inserted>(
      `INSERT INTO dose_events (medication_time_id, person_id, scheduled_for, status, send_attempts, claimed_at)
       SELECT * FROM unnest($1::bigint[], $2::uuid[], $3::timestamptz[],
                            array_fill($4::text, ARRAY[$5::int]),
                            array_fill($6::smallint, ARRAY[$5::int]),
                            array_fill($7::timestamptz, ARRAY[$5::int]))
       ON CONFLICT (medication_time_id, scheduled_for) DO NOTHING
       RETURNING id, person_id`,
      [args.map((a) => a.mt), args.map((a) => a.p), args.map((a) => a.at), status, args.length,
        status === "pending" ? 1 : 0, status === "pending" ? now : null],
    );
  };
  const due = await insert(dueArgs, "pending");
  const staleIns = await insert(staleArgs, "missed_system");
  return { due, stale: staleIns.map((r) => ({ ...r, ...meta.get(r.person_id)! })) };
}

async function notifyStale(api: TgApi, stale: { person_id: string; name: string; admin: number }[]) {
  const byPerson = new Map<string, { name: string; admin: number; n: number }>();
  for (const s of stale) {
    const e = byPerson.get(s.person_id) ?? { name: s.name, admin: s.admin, n: 0 };
    e.n++;
    byPerson.set(s.person_id, e);
  }
  for (const e of byPerson.values()) {
    await api.sendMessage(e.admin, fa.notifyStale(e.name, e.n), { parse_mode: "HTML" }).catch(() => {});
  }
}

/** Retry sends that died mid-flight (network error / crash). Atomic claim => no double send. */
async function claimRetries(now: Date): Promise<Inserted[]> {
  return query<Inserted>(
    `UPDATE dose_events SET status='pending', send_attempts=send_attempts+1, claimed_at=$1
     WHERE status IN ('pending','send_failed') AND send_attempts < $2
       AND COALESCE(snooze_until, scheduled_for) > $1::timestamptz - make_interval(mins => $3)
       AND (claimed_at IS NULL OR claimed_at < $1::timestamptz - interval '90 seconds')
       AND person_id IN (SELECT id FROM people WHERE status='active')
     RETURNING id, person_id`,
    [now, config.maxSendAttempts, config.retryWindowMin],
  );
}

/** Snoozes whose time has come become fresh reminders (new message). */
async function claimSnoozed(now: Date): Promise<Inserted[]> {
  return query<Inserted>(
    `UPDATE dose_events SET status='pending', send_attempts=1, claimed_at=$1
     WHERE status='snoozed' AND snooze_until <= $1
       AND person_id IN (SELECT id FROM people WHERE status='active')
     RETURNING id, person_id`,
    [now],
  );
}

async function sendGroups(api: TgApi, claimed: Inserted[], now: Date, sleep: (ms: number) => Promise<void>) {
  const out = { sent: 0, failed: 0 };
  if (!claimed.length) return out;
  const rows = await query<DoseRow>(`${DOSE_SELECT} WHERE d.id = ANY($1) ORDER BY m.name, d.id`, [claimed.map((c) => c.id)]);

  // One message per person per scheduled instant (or per snooze wake-up).
  const groups = new Map<string, DoseRow[]>();
  for (const r of rows) {
    const key = `${r.person_id}|${r.snooze_count > 0 ? "z" : "s"}|${r.snooze_count > 0 ? Math.floor(+(r.snooze_until ?? r.scheduled_for) / 60000) : +r.scheduled_for}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }

  for (const group of groups.values()) {
    const ids = group.map((r) => r.id);
    const chat = group[0].chat_id;
    if (!chat) continue;
    try {
      const { text, reply_markup } = renderReminder(group.map((r) => ({ ...r, status: "sent" })));
      const msg = await api.sendMessage(chat, text, { parse_mode: "HTML", reply_markup });
      await query(
        `UPDATE dose_events SET status='sent', sent_at=$3, telegram_message_id=$2, snooze_until=NULL, nudge_count=0
         WHERE id = ANY($1) AND status='pending'`,
        [ids, msg.message_id, now],
      );
      out.sent += ids.length;
    } catch (e: any) {
      if (isBlockedError(e)) {
        await markBlocked(api, group[0].person_id);
      } else {
        await query(`UPDATE dose_events SET status='send_failed' WHERE id = ANY($1) AND status='pending'`, [ids]);
        console.error("send failed", { person: group[0].person_id, doses: ids, code: e?.error_code });
      }
      out.failed += ids.length;
    }
    await sleep(SEND_GAP_MS);
  }
  return out;
}

/** Gentle follow-ups, as a reply to the original message. Offsets come from config. */
async function sendNudges(api: TgApi, now: Date, sleep: (ms: number) => Promise<void>): Promise<number> {
  const offsets = config.nudgeOffsetsMin;
  if (!offsets.length) return 0;
  // Atomic claim: nudge_count is bumped by exactly one runner per dose and step.
  const claimed = await query<{ person_id: string; telegram_message_id: number; nudge_count: number; chat_id: number }>(
    `UPDATE dose_events d SET nudge_count = nudge_count + 1
     FROM people p
     WHERE p.id = d.person_id AND p.status='active' AND d.status='sent'
       AND d.nudge_count < cardinality($1::int[])
       AND d.sent_at + make_interval(mins => ($1::int[])[d.nudge_count + 1]) <= $2
     RETURNING d.person_id, d.telegram_message_id, d.nudge_count, p.telegram_chat_id AS chat_id`,
    [offsets, now],
  );
  const msgs = new Map<string, (typeof claimed)[number]>();
  for (const c of claimed) msgs.set(`${c.person_id}:${c.telegram_message_id}`, c);
  let n = 0;
  for (const c of msgs.values()) {
    if (!c.telegram_message_id || !c.chat_id) continue;
    const text = fa.nudge[Math.min(c.nudge_count - 1, fa.nudge.length - 1)];
    try {
      await api.sendMessage(c.chat_id, text, { reply_parameters: { message_id: c.telegram_message_id, allow_sending_without_reply: true } });
      n++;
    } catch (e) {
      if (isBlockedError(e)) await markBlocked(api, c.person_id);
    }
    await sleep(SEND_GAP_MS);
  }
  return n;
}
