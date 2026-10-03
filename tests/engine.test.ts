import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const URL = process.env.TEST_DATABASE_URL;
const d = URL ? describe : describe.skip;

process.env.DATABASE_URL = URL;
process.env.ADMIN_CHAT_IDS = "900";

const ADMIN = 900, CHAT = 111;
const T0 = new Date("2026-10-05T04:30:30Z"); // 08:00 Asia/Tehran (UTC+3:30), a Monday
const min = (n: number, from = T0) => new Date(+from + n * 60_000);

class FakeApi {
  sent: { chat: number; text: string; other: any; id: number }[] = [];
  edits: { chat: number; id: number; text: string }[] = [];
  next = 1000;
  failWith: any = null;
  async sendMessage(chat: number, text: string, other: any = {}) {
    if (this.failWith && chat === CHAT) throw this.failWith;
    const id = this.next++;
    this.sent.push({ chat, text, other, id });
    return { message_id: id };
  }
  async editMessageText(chat: number, id: number, text: string) { this.edits.push({ chat, id, text }); }
  async editMessageReplyMarkup() {}
  toPatient() { return this.sent.filter((s) => s.chat === CHAT); }
}
const nosleep = async () => {};

d("reminder engine (postgres)", () => {
  let db: typeof import("../src/lib/db");
  let eng: typeof import("../src/engine/remind");
  let clean: typeof import("../src/engine/cleanup");
  let personId: string, medTime: number, medTime2: number;

  beforeAll(async () => {
    db = await import("../src/lib/db");
    eng = await import("../src/engine/remind");
    clean = await import("../src/engine/cleanup");
    await db.pool().query(readFileSync("db/schema.sql", "utf8"));
  });
  afterAll(async () => { await db.pool().end(); });

  beforeEach(async () => {
    await db.pool().query("TRUNCATE people, kv, admin_state RESTART IDENTITY CASCADE");
    const p = await db.query(
      `INSERT INTO people (display_name, telegram_chat_id, timezone, status, active_since, created_by_admin_chat_id)
       VALUES ('Ali', $1, 'Asia/Tehran', 'active', '2026-10-01', $2) RETURNING id`, [CHAT, ADMIN]);
    personId = p[0].id;
    const addMed = async (name: string, time: string) => {
      const m = await db.query(
        `INSERT INTO medications (person_id, name, dose, note, start_date) VALUES ($1,$2,'1 tab','after food','2026-10-01') RETURNING id`,
        [personId, name]);
      const t = await db.query(
        `INSERT INTO medication_times (medication_id, local_time, created_at) VALUES ($1,$2,'2026-10-01') RETURNING id`, [m[0].id, time]);
      return t[0].id as number;
    };
    medTime = await addMed("Metformin", "08:00");
    medTime2 = 0;
  });

  const doses = () => db.query(`SELECT * FROM dose_events ORDER BY id`);

  it("sends a due dose once, with 3 buttons and short callback_data", async () => {
    const api = new FakeApi();
    const s = await eng.runRemind(api, T0, nosleep);
    expect(s.sent).toBe(1);
    const msg = api.toPatient()[0];
    expect(msg.text).toContain("Metformin");
    const kb = msg.other.reply_markup.inline_keyboard.flat();
    expect(kb).toHaveLength(3);
    for (const b of kb) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
    expect((await doses())[0].status).toBe("sent");
  });

  it("is idempotent: re-running and 5 concurrent crons still send exactly once", async () => {
    const api = new FakeApi();
    await Promise.all(Array.from({ length: 5 }, () => eng.runRemind(api, T0, nosleep)));
    await eng.runRemind(api, min(1), nosleep);
    expect(api.toPatient().filter((m) => m.text.includes("Metformin"))).toHaveLength(1);
    expect(await doses()).toHaveLength(1);
  });

  it("does not send a dose before its time", async () => {
    const api = new FakeApi();
    await eng.runRemind(api, min(-1), nosleep);
    expect(api.sent).toHaveLength(0);
  });

  it("recovers one missed tick inside the 5 min window", async () => {
    const api = new FakeApi();
    await eng.runRemind(api, min(4), nosleep);
    expect(api.toPatient()).toHaveLength(1);
  });

  it("stale dose (cron down) is never sent: missed_system + admin told", async () => {
    const api = new FakeApi();
    await eng.runRemind(api, min(120), nosleep);
    expect(api.toPatient()).toHaveLength(0);
    expect((await doses())[0].status).toBe("missed_system");
    expect(api.sent.some((m) => m.chat === ADMIN)).toBe(true);
  });

  it("groups two medications at the same time into one message", async () => {
    const m = await db.query(`INSERT INTO medications (person_id,name,dose,start_date) VALUES ($1,'Aspirin','1','2026-10-01') RETURNING id`, [personId]);
    await db.query(`INSERT INTO medication_times (medication_id, local_time, created_at) VALUES ($1,'08:00','2026-10-01')`, [m[0].id]);
    const api = new FakeApi();
    await eng.runRemind(api, T0, nosleep);
    expect(api.toPatient()).toHaveLength(1);
    const kb = api.toPatient()[0].other.reply_markup.inline_keyboard;
    expect(kb[0][0].callback_data).toBe("at"); // "took all"
    expect(kb.length).toBe(3);                 // all + one row per med
  });

  it("never backfills before the person was started", async () => {
    await db.query(`UPDATE people SET active_since=$1`, [min(10)]);
    const api = new FakeApi();
    await eng.runRemind(api, min(12), nosleep);
    expect(await doses()).toHaveLength(0);
  });

  it("never sends for a time slot created after the dose time", async () => {
    await db.query(`UPDATE medication_times SET created_at=$1`, [min(2)]);
    const api = new FakeApi();
    await eng.runRemind(api, min(3), nosleep);
    expect(await doses()).toHaveLength(0);
  });

  it("does nothing for paused / connected people", async () => {
    await db.query(`UPDATE people SET status='connected'`);
    const api = new FakeApi();
    await eng.runRemind(api, T0, nosleep);
    expect(api.sent).toHaveLength(0);
  });

  it("nudges at 15 and 45 min as replies, then stops; no nudge after taken", async () => {
    const api = new FakeApi();
    await eng.runRemind(api, T0, nosleep);
    const orig = api.toPatient()[0].id;
    await eng.runRemind(api, min(14), nosleep);
    expect(api.toPatient()).toHaveLength(1);
    await eng.runRemind(api, min(16), nosleep);
    expect(api.toPatient()).toHaveLength(2);
    expect(api.toPatient()[1].other.reply_parameters.message_id).toBe(orig);
    await eng.runRemind(api, min(17), nosleep);
    expect(api.toPatient()).toHaveLength(2);
    await eng.runRemind(api, min(46), nosleep);
    expect(api.toPatient()).toHaveLength(3);
    await eng.runRemind(api, min(80), nosleep);
    expect(api.toPatient()).toHaveLength(3);

    await db.pool().query("TRUNCATE dose_events RESTART IDENTITY CASCADE");
    const api2 = new FakeApi();
    await eng.runRemind(api2, T0, nosleep);
    await db.query(`UPDATE dose_events SET status='taken', responded_at=now()`);
    await eng.runRemind(api2, min(16), nosleep);
    expect(api2.toPatient()).toHaveLength(1);
  });

  it("unanswered for 2h => missed, buttons removed", async () => {
    const api = new FakeApi();
    await eng.runRemind(api, T0, nosleep);
    await db.query(`UPDATE dose_events SET sent_at=$1`, [T0]);
    await eng.runRemind(api, min(121), nosleep);
    expect((await doses())[0].status).toBe("missed");
    expect(api.edits.at(-1)?.text).toContain("بدون پاسخ");
  });

  it("snoozed dose is re-sent as a new message once snooze_until passes", async () => {
    const api = new FakeApi();
    await eng.runRemind(api, T0, nosleep);
    await db.query(`UPDATE dose_events SET status='snoozed', snooze_count=1, snooze_until=$1`, [min(30)]);
    await eng.runRemind(api, min(29), nosleep);
    expect(api.toPatient()).toHaveLength(1);
    await eng.runRemind(api, min(31), nosleep);
    expect(api.toPatient()).toHaveLength(2);
    expect((await doses())[0].status).toBe("sent");
    expect((await doses())[0].telegram_message_id).toBe(api.toPatient()[1].id);
  });

  it("403 from Telegram marks the person blocked and tells the admin", async () => {
    const api = new FakeApi();
    api.failWith = { error_code: 403, description: "Forbidden: bot was blocked by the user" };
    await eng.runRemind(api, T0, nosleep);
    const p = await db.query(`SELECT status, resume_status FROM people`);
    expect(p[0]).toMatchObject({ status: "blocked", resume_status: "active" });
    expect(api.sent.some((m) => m.chat === ADMIN && m.text.includes("Ali"))).toBe(true);
    expect((await doses())[0].status).toBe("cancelled");
  });

  it("network failure => send_failed, then retried (not duplicated) on a later tick", async () => {
    const api = new FakeApi();
    api.failWith = new Error("ECONNRESET");
    await eng.runRemind(api, T0, nosleep);
    expect((await doses())[0].status).toBe("send_failed");
    api.failWith = null;
    await eng.runRemind(api, min(1), nosleep);          // too soon to reclaim (<90s)
    expect(api.toPatient()).toHaveLength(0);
    await eng.runRemind(api, min(2), nosleep);
    expect(api.toPatient()).toHaveLength(1);
    expect((await doses())[0].status).toBe("sent");
    await eng.runRemind(api, min(3), nosleep);
    expect(api.toPatient()).toHaveLength(1);
  });

  it("gives up after 3 attempts", async () => {
    const api = new FakeApi();
    api.failWith = new Error("ECONNRESET");
    for (let i = 0; i < 8; i++) await eng.runRemind(api, min(i * 2), nosleep);
    expect((await doses())[0].send_attempts).toBe(3);
  });

  it("writes an audit trail of every status change", async () => {
    const api = new FakeApi();
    await eng.runRemind(api, T0, nosleep);
    await db.query(`UPDATE dose_events SET status='taken', responded_at=now()`);
    const log = await db.query(`SELECT status FROM dose_status_log ORDER BY id`);
    expect(log.map((l) => l.status)).toEqual(["pending", "sent", "taken"]);
  });

  it("medication past its end date stops sending", async () => {
    await db.query(`UPDATE medications SET end_date='2026-10-04'`);
    const api = new FakeApi();
    await eng.runRemind(api, T0, nosleep);
    expect(api.sent).toHaveLength(0);
  });

  it("deleting a person hard-deletes everything", async () => {
    const api = new FakeApi();
    await eng.runRemind(api, T0, nosleep);
    await db.query(`DELETE FROM people WHERE id=$1`, [personId]);
    for (const t of ["medications", "medication_times", "dose_events", "dose_status_log", "invites"]) {
      expect(await db.query(`SELECT 1 FROM ${t}`)).toHaveLength(0);
    }
  });

  it("cleanup alerts admins when cron went quiet (throttled)", async () => {
    const api = new FakeApi();
    await db.kvSet("last_cron", { at: min(-60).toISOString() });
    const r1 = await clean.runCleanup(api, T0);
    const r2 = await clean.runCleanup(api, min(5));
    expect(r1.alerted).toBe(true);
    expect(r2.alerted).toBe(false);
  });
});
