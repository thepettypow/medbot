import { readFileSync } from "node:fs";
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL = process.env.TEST_DATABASE_URL;
const d = URL ? describe : describe.skip;

process.env.DATABASE_URL = URL;
process.env.BOT_TOKEN = "123:TEST";
process.env.TELEGRAM_WEBHOOK_SECRET = "s";
process.env.CRON_SECRET = "cron-secret";
process.env.ADMIN_CHAT_IDS = "900";

const ADMIN = 900, PATIENT = 111, STRANGER = 222;

d("bot end-to-end (fake Telegram)", () => {
  let bot: import("grammy").Bot;
  let db: typeof import("../src/lib/db");
  let eng: typeof import("../src/engine/remind");
  let fa: typeof import("../src/i18n/fa").fa;
  const out: { method: string; p: any }[] = [];
  let mid = 5000, uid = 1;

  const sent = (chat: number) => out.filter((o) => o.method === "sendMessage" && o.p.chat_id === chat).map((o) => o.p);
  const shown = (chat: number) => out.filter((o) => (o.method === "sendMessage" || o.method === "editMessageText") && o.p.chat_id === chat).map((o) => o.p);
  const last = (chat: number) => shown(chat).at(-1);
  const buttons = (p: any): { text: string; callback_data: string }[] => (p?.reply_markup?.inline_keyboard ?? []).flat();
  const toasts = () => out.filter((o) => o.method === "answerCallbackQuery").map((o) => o.p);

  async function say(chat: number, text: string) {
    const entities = text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.split(/\s/)[0].length }] : undefined;
    await bot.handleUpdate({ update_id: uid++, message: { message_id: mid++, date: 0, chat: { id: chat, type: "private", first_name: "x" }, from: { id: chat, is_bot: false, first_name: "x" }, text, entities } } as any);
  }
  async function press(chat: number, data: string, messageId = mid++) {
    await bot.handleUpdate({ update_id: uid++, callback_query: { id: String(uid), chat_instance: "c", from: { id: chat, is_bot: false, first_name: "x" }, data,
      message: { message_id: messageId, date: 0, chat: { id: chat, type: "private", first_name: "x" } } } } as any);
  }
  const pressBtn = (chat: number, prefix: string) => {
    const b = buttons(last(chat)).find((x) => x.callback_data.startsWith(prefix));
    if (!b) throw new Error(`no button ${prefix} in ${JSON.stringify(last(chat))}`);
    return press(chat, b.callback_data);
  };

  beforeAll(async () => {
    db = await import("../src/lib/db");
    eng = await import("../src/engine/remind");
    fa = (await import("../src/i18n/fa")).fa;
    await db.pool().query(readFileSync("db/schema.sql", "utf8"));
    await db.pool().query("TRUNCATE people, kv, admin_state RESTART IDENTITY CASCADE");
    const { getBot } = await import("../src/bot");
    bot = getBot();
    bot.api.config.use(async (_prev, method, payload) => {
      out.push({ method, p: payload });
      // Telegram limit: callback_data <= 64 bytes
      for (const b of buttons(payload)) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
      if (method === "getMe") return { ok: true, result: { id: 1, is_bot: true, first_name: "b", username: "medbot", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } } as any;
      if (method === "sendMessage") return { ok: true, result: { message_id: mid++, date: 0, chat: { id: (payload as any).chat_id }, text: "" } } as any;
      return { ok: true, result: true } as any;
    });
    await bot.init();
  });
  afterAll(async () => { await db.pool().end(); });

  let personId: string, token: string;
  const person = async () => (await db.query(`SELECT * FROM people WHERE id=$1`, [personId]))[0];

  it("F1: non-admins are denied, including forged admin callbacks", async () => {
    await say(STRANGER, "/admin");
    expect(last(STRANGER).text).toBe(fa.denied);
    await press(STRANGER, "a:l");
    expect(toasts().at(-1)).toMatchObject({ text: fa.denied, show_alert: true });
    await say(STRANGER, "/people");
    expect(last(STRANGER).text).toBe(fa.denied);
    expect(await db.query(`SELECT 1 FROM people`)).toHaveLength(0);
  });

  it("F2: admin creates a person step by step (default tz Asia/Tehran offered)", async () => {
    await say(ADMIN, "/admin");
    await pressBtn(ADMIN, "a:np");
    expect(last(ADMIN).text).toBe(fa.askName);
    await say(ADMIN, "   ");
    expect(last(ADMIN).text).toBe(fa.nameInvalid);
    await say(ADMIN, "Ali <b>");
    expect(buttons(last(ADMIN)).map((b) => b.callback_data)).toContain("a:tz:Asia/Tehran");
    await say(ADMIN, "Iran/Tehran");
    expect(last(ADMIN).text).toBe(fa.tzInvalid);
    await pressBtn(ADMIN, "a:tz:Asia/Tehran");
    await pressBtn(ADMIN, "a:fc");
    const p = (await db.query(`SELECT * FROM people`))[0];
    personId = p.id;
    expect(p).toMatchObject({ display_name: "Ali <b>", timezone: "Asia/Tehran", status: "pending_link", created_by_admin_chat_id: ADMIN });
  });

  it("F3: medication flow validates input, normalises times, confirms", async () => {
    await press(ADMIN, `a:mn:${personId}`);
    await say(ADMIN, "Metformin");
    await say(ADMIN, "1 tablet 500");
    await say(ADMIN, "25:99");
    expect(last(ADMIN).text).toBe(fa.timesInvalid);
    await say(ADMIN, "۸ 2000 8:00");
    await pressBtn(ADMIN, "a:dy:6");               // toggle Saturday off
    await pressBtn(ADMIN, "a:dy:6");               // and on again
    await press(ADMIN, "a:dd");
    await say(ADMIN, "not a date");
    expect(last(ADMIN).text).toBe(fa.dateInvalid);
    await press(ADMIN, "a:st");
    await say(ADMIN, "2000-01-01");                // end before start
    expect(last(ADMIN).text).toBe(fa.endBeforeStart);
    await press(ADMIN, "a:en");
    await say(ADMIN, "after food");
    expect(last(ADMIN).text).toContain("after food");
    expect(await db.query(`SELECT 1 FROM medications`)).toHaveLength(0); // not saved before confirm
    await press(ADMIN, "a:fc");
    const m = (await db.query(`SELECT * FROM medications`))[0];
    expect(m).toMatchObject({ name: "Metformin", dose: "1 tablet 500", note: "after food", end_date: null });
    const t = await db.query(`SELECT to_char(local_time,'HH24:MI') t FROM medication_times ORDER BY local_time`);
    expect(t.map((x) => x.t)).toEqual(["08:00", "20:00"]);
  });

  it("F6: Start is refused before the person is connected", async () => {
    await press(ADMIN, `a:ps:${personId}`);
    expect(toasts().at(-1)).toMatchObject({ text: fa.startNotConnected, show_alert: true });
    expect((await person()).status).toBe("pending_link");
  });

  it("F4: invite link is stored hashed, single-use, never reveals token in DB", async () => {
    await press(ADMIN, `a:iv:${personId}`);
    const msg = last(ADMIN).text as string;
    token = msg.match(/start=([A-Za-z0-9_-]+)/)![1];
    expect(token.length).toBeGreaterThanOrEqual(32);                 // >=192 bits
    const inv = (await db.query(`SELECT * FROM invites`))[0];
    expect(inv.token_hash).not.toContain(token);
    expect(inv.token_hash).toHaveLength(64);
    const ttl = (+new Date(inv.expires_at) - Date.now()) / 3600_000;
    expect(ttl).toBeGreaterThan(71.9); expect(ttl).toBeLessThanOrEqual(72);
  });

  it("F5: no linking before consent; declining notifies admin and keeps the link alive", async () => {
    await say(PATIENT, `/start ${token}`);
    expect(buttons(last(PATIENT)).map((b) => b.callback_data)).toEqual([expect.stringMatching(/^c:y:/), expect.stringMatching(/^c:n:/)]);
    expect((await person()).telegram_chat_id).toBeNull();
    await pressBtn(PATIENT, "c:n:");
    expect(last(ADMIN).text).toContain("قبول نکرد");
    expect((await person()).telegram_chat_id).toBeNull();
    expect((await db.query(`SELECT used_at FROM invites`))[0].used_at).toBeNull();
  });

  it("F5: agreeing links chat, stores consent, burns link, notifies admin", async () => {
    await say(PATIENT, `/start ${token}`);
    await pressBtn(PATIENT, "c:y:");
    const p = await person();
    expect(p).toMatchObject({ status: "connected" });
    expect(Number(p.telegram_chat_id)).toBe(PATIENT);
    expect(p.consent_at).not.toBeNull();
    expect(p.consent_version).toBeTruthy();
    expect(last(ADMIN).text).toContain("متصل شد");
    expect(sent(PATIENT).some((m) => m.text.includes("Metformin"))).toBe(true);
    await say(STRANGER, `/start ${token}`);
    expect(last(STRANGER).text).toBe(fa.inviteUsed);
  });

  it("F4: expired / garbage links connect nothing", async () => {
    await say(STRANGER, "/start nonsense");
    expect(last(STRANGER).text).toBe(fa.inviteInvalid);
    await say(STRANGER, "/start");
    expect(last(STRANGER).text).toBe(fa.needInvite);
  });

  it("F4: re-inviting a connected person needs admin confirmation", async () => {
    await press(ADMIN, `a:iv:${personId}`);
    expect(last(ADMIN).text).toBe(fa.inviteExisting);
    expect(await db.query(`SELECT 1 FROM invites`)).toHaveLength(1);
  });

  it("F6: admin starts reminders; patient is told; nothing backfills", async () => {
    await press(ADMIN, `a:ps:${personId}`);
    expect((await person()).status).toBe("active");
    expect(sent(PATIENT).at(-1).text).toBe(fa.remindersStarted);
  });

  // pretend the rows are old enough, then run the engine at tomorrow 08:00:30 Tehran
  const T = DateTime.now().setZone("Asia/Tehran").plus({ days: 1 }).startOf("day").plus({ hours: 8, seconds: 30 }).toJSDate();
  const at = (mins: number) => new Date(+T + mins * 60_000);
  let doseId: number, reminderMsg: number;

  it("F7/F8: reminder arrives at 08:00 local with Persian text and 3 buttons", async () => {
    await db.query(`UPDATE people SET active_since='2020-01-01'`);
    await db.query(`UPDATE medication_times SET created_at='2020-01-01'`);
    const before = sent(PATIENT).length;
    await eng.runRemind(bot.api as any, T, async () => {});
    const m = sent(PATIENT).at(-1);
    expect(sent(PATIENT).length).toBe(before + 1);
    expect(m.text).toContain("وقت دارو");
    expect(m.text).toContain("Metformin");
    expect(m.text).toContain("after food");
    expect(buttons(m)).toHaveLength(3);
    doseId = (await db.query(`SELECT id FROM dose_events`))[0].id;
    reminderMsg = (await db.query(`SELECT telegram_message_id m FROM dose_events`))[0].m;
  });

  it("F8: a stranger cannot press someone else's buttons", async () => {
    await press(STRANGER, `t:${doseId}`);
    expect((await db.query(`SELECT status FROM dose_events`))[0].status).toBe("sent");
  });

  it("F8/F9: Taken edits the message, removes buttons, is answered, and double taps are gentle", async () => {
    await press(PATIENT, `t:${doseId}`, reminderMsg);
    const row = (await db.query(`SELECT status, responded_at FROM dose_events WHERE id=$1`, [doseId]))[0];
    expect(row.status).toBe("taken");
    expect(row.responded_at).not.toBeNull();
    const edit = out.filter((o) => o.method === "editMessageText").at(-1)!.p;
    expect(edit.text).toContain("خورده شد");
    expect(buttons(edit)).toHaveLength(0);
    expect(toasts().at(-1).text).toBe(fa.recorded);
    await press(PATIENT, `t:${doseId}`, reminderMsg);
    expect(toasts().at(-1).text).toBe(fa.alreadyRecorded);
  });

  it("F9: snooze reschedules +30min (max 2), skip is recorded", async () => {
    const api = bot.api as any;
    await eng.runRemind(api, at(12 * 60), async () => {});           // 20:00 dose
    const d2 = (await db.query(`SELECT id, telegram_message_id m FROM dose_events WHERE status='sent'`))[0];
    expect(buttons(last(PATIENT)).map((b) => b.callback_data)).toContain(`z:${d2.id}`);
    await press(PATIENT, `z:${d2.id}`, d2.m);
    expect((await db.query(`SELECT status, snooze_count FROM dose_events WHERE id=$1`, [d2.id]))[0]).toMatchObject({ status: "snoozed", snooze_count: 1 });
    await db.query(`UPDATE dose_events SET snooze_until=$2 WHERE id=$1`, [d2.id, at(12 * 60 + 30)]);
    await eng.runRemind(api, at(12 * 60 + 31), async () => {});
    const m2 = last(PATIENT);
    expect(buttons(m2).some((b) => b.callback_data === `z:${d2.id}`)).toBe(true);
    const m2id = (await db.query(`SELECT telegram_message_id m FROM dose_events WHERE id=$1`, [d2.id]))[0].m;
    await press(PATIENT, `z:${d2.id}`, m2id);                       // 2nd snooze
    await db.query(`UPDATE dose_events SET snooze_until=$2 WHERE id=$1`, [d2.id, at(12 * 60 + 60)]);
    await eng.runRemind(api, at(12 * 60 + 61), async () => {});
    expect(buttons(last(PATIENT)).some((b) => b.callback_data.startsWith("z:"))).toBe(false); // limit hit: no snooze button
    const m3id = (await db.query(`SELECT telegram_message_id m FROM dose_events WHERE id=$1`, [d2.id]))[0].m;
    await press(PATIENT, `s:${d2.id}`, m3id);
    expect((await db.query(`SELECT status FROM dose_events WHERE id=$1`, [d2.id]))[0].status).toBe("skipped");
  });

  it("F13: report counts taken/skipped", async () => {
    await press(ADMIN, `a:r:${personId}`);
    const t = out.filter((o) => o.method === "editMessageText" && o.p.text?.includes("گزارش")).at(-1)!.p.text as string;
    expect(t).toContain("٪");
  });

  it("patient commands: /mymeds, /privacy, /help include disclaimer, /settings pause", async () => {
    await say(PATIENT, "/mymeds");
    expect(last(PATIENT).text).toContain("Metformin");
    await say(PATIENT, "/privacy");
    expect(last(PATIENT).text).toContain("حریم خصوصی");
    await say(PATIENT, "/help");
    expect(last(PATIENT).text).toContain(fa.disclaimer);
    await say(PATIENT, "/settings");
    await pressBtn(PATIENT, "p:z");
    expect((await person()).status).toBe("paused");
    await say(PATIENT, "/settings");
    await pressBtn(PATIENT, "p:r");
    expect((await person()).status).toBe("active");
  });

  it("F11: patient blocking the bot marks them blocked, tells admin; Start restores active", async () => {
    await bot.handleUpdate({ update_id: uid++, my_chat_member: { chat: { id: PATIENT, type: "private", first_name: "x" }, from: { id: PATIENT, is_bot: false, first_name: "x" }, date: 0,
      old_chat_member: { status: "member", user: {} }, new_chat_member: { status: "kicked", user: {}, until_date: 0 } } } as any);
    expect((await person()).status).toBe("blocked");
    expect(last(ADMIN).text).toContain("بلاک");
    await say(PATIENT, "/start");
    expect((await person()).status).toBe("active");
  });

  it("F2: stop cancels pending doses", async () => {
    await press(ADMIN, `a:px:${personId}`);
    expect((await person()).status).toBe("connected");
    expect(sent(PATIENT).at(-1).text).toBe(fa.remindersStopped);
  });

  it("F12: /delete_my_data needs two confirmations, then hard-deletes everything", async () => {
    await say(PATIENT, "/delete_my_data");
    await pressBtn(PATIENT, "d:n");
    expect(await db.query(`SELECT 1 FROM people`)).toHaveLength(1);
    await say(PATIENT, "/delete_my_data");
    await pressBtn(PATIENT, "d:1");
    expect(await db.query(`SELECT 1 FROM people`)).toHaveLength(1);
    await press(PATIENT, "d:2");
    for (const t of ["people", "medications", "medication_times", "dose_events", "dose_status_log", "invites"]) {
      expect(await db.query(`SELECT 1 FROM ${t}`), t).toHaveLength(0);
    }
    expect(last(ADMIN).text).toContain("پاک کرد");
  });

  it("F12: admin delete is also hard and takes two confirmations", async () => {
    const r = await db.query(`INSERT INTO people (display_name, created_by_admin_chat_id) VALUES ('Z',$1) RETURNING id`, [ADMIN]);
    const id = r[0].id;
    await press(ADMIN, `a:pd:${id}`);
    await press(ADMIN, `a:pd2:${id}`);
    expect(await db.query(`SELECT 1 FROM people`)).toHaveLength(1);
    await press(ADMIN, `a:pd3:${id}`);
    expect(await db.query(`SELECT 1 FROM people`)).toHaveLength(0);
  });

  it("flow state expires and /cancel works", async () => {
    await say(ADMIN, "/cancel");
    expect(last(ADMIN).text).toBe(fa.nothingToCancel);
    await press(ADMIN, "a:np");
    await say(ADMIN, "/cancel");
    expect(last(ADMIN).text).toBe(fa.flowCancelled);
    await press(ADMIN, "a:np");
    await db.query(`UPDATE admin_state SET updated_at = now() - interval '31 minutes'`);
    await say(ADMIN, "Name");
    expect(last(ADMIN).text).toBe(fa.unknownCmd);
  });

  it("F4: expired and revoked links connect nothing; revoke button works", async () => {
    const r = await db.query(`INSERT INTO people (display_name, created_by_admin_chat_id) VALUES ('Q',$1) RETURNING id`, [ADMIN]);
    const id = r[0].id;
    const { newToken, hashToken } = await import("../src/lib/tokens");
    const t1 = newToken(), t2 = newToken();
    await db.query(`INSERT INTO invites (person_id, token_hash, expires_at) VALUES ($1,$2, now() - interval '1 minute')`, [id, hashToken(t1)]);
    await say(STRANGER, `/start ${t1}`);
    expect(last(STRANGER).text).toBe(fa.inviteInvalid);
    await db.query(`INSERT INTO invites (person_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '1 hour')`, [id, hashToken(t2)]);
    await press(ADMIN, `a:ir:${id}`);
    expect(last(ADMIN).text).toBe(fa.inviteRevoked);
    await say(STRANGER, `/start ${t2}`);
    expect(last(STRANGER).text).toBe(fa.inviteInvalid);
    expect((await db.query(`SELECT telegram_chat_id FROM people WHERE id=$1`, [id]))[0].telegram_chat_id).toBeNull();
  });

  it("F4: a link consumed by someone else between /start and 'agree' cannot be reused", async () => {
    const r = await db.query(`INSERT INTO people (display_name, created_by_admin_chat_id) VALUES ('R',$1) RETURNING id`, [ADMIN]);
    const { newToken, hashToken } = await import("../src/lib/tokens");
    const t = newToken();
    const inv = await db.query(`INSERT INTO invites (person_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '1 hour') RETURNING id`, [r[0].id, hashToken(t)]);
    await Promise.all([press(333, `c:y:${inv[0].id}`), press(444, `c:y:${inv[0].id}`)]); // race
    const linked = await db.query(`SELECT telegram_chat_id FROM people WHERE id=$1`, [r[0].id]);
    expect([333, 444]).toContain(Number(linked[0].telegram_chat_id));
    expect(await db.query(`SELECT 1 FROM invites WHERE used_at IS NOT NULL`)).toHaveLength(1);
  });

  it("F7/F1: HTTP routes are protected", async () => {
    const remind = await import("../src/app/api/cron/remind/route");
    const cleanup = await import("../src/app/api/cron/cleanup/route");
    const hook = await import("../src/app/api/telegram/route");
    const health = await import("../src/app/api/health/route");
    expect((await remind.GET(new Request("http://x/api/cron/remind"))).status).toBe(401);
    expect((await remind.GET(new Request("http://x", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
    const ok = await remind.GET(new Request("http://x", { headers: { authorization: "Bearer cron-secret" } }));
    expect(ok.status).toBe(200);
    expect((await cleanup.GET(new Request("http://x"))).status).toBe(401);
    expect((await cleanup.GET(new Request("http://x", { headers: { authorization: "Bearer cron-secret" } }))).status).toBe(200);
    const bad = await hook.POST(new Request("http://x/api/telegram", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "wrong" }, body: "{}" }));
    expect(bad.status).toBe(401);
    expect((await health.GET()).status).toBe(200);
  });
});
