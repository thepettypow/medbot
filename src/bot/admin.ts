import { InlineKeyboard, type Bot, type Context } from "grammy";
import { DateTime } from "luxon";
import { config, isAdmin } from "@/lib/config";
import { kvGet, query, tx } from "@/lib/db";
import { newToken, hashToken } from "@/lib/tokens";
import { isValidZone, parseDate, parseTimes, toFa } from "@/lib/time";
import { cancelOpenDoses } from "@/engine/people";
import { DAY_ORDER, DAY_SHORT, STATUS_LABEL, daysLabel, esc, fa } from "@/i18n/fa";
import { clearState, getState, setState, type FlowState } from "./flows";
import { getMed, getMeds, getPerson, setMedTimes, type Med, type Person } from "./queries";

const H = { parse_mode: "HTML" as const };
type Kb = InlineKeyboard | undefined;

const ZONE_RE = /^(UTC|[A-Za-z_]+\/[A-Za-z_+\-0-9/]+)$/;
const zoneOk = (z: string) => ZONE_RE.test(z) && isValidZone(z);

async function show(ctx: Context, text: string, kb?: Kb) {
  if (ctx.callbackQuery) {
    try { return void await ctx.editMessageText(text, { ...H, reply_markup: kb }); }
    catch (e: any) { if (/not modified/i.test(String(e?.description))) return; }
  }
  await ctx.reply(text, { ...H, reply_markup: kb });
}

// ───────────────────────── views ─────────────────────────
const menuKb = () => new InlineKeyboard()
  .text(fa.btnNewPerson, "a:np").text(fa.btnPeople, "a:l").row().text(fa.btnStatus, "a:ss");

async function showMenu(ctx: Context) { await show(ctx, fa.adminMenu, menuKb()); }

async function showPeople(ctx: Context, report = false) {
  const people = await query<Person>(`SELECT * FROM people ORDER BY created_at DESC LIMIT 50`);
  if (!people.length) return show(ctx, fa.noPeople, new InlineKeyboard().text(fa.btnNewPerson, "a:np").row().text(fa.btnMenu, "a:m"));
  const kb = new InlineKeyboard();
  for (const p of people) kb.text(`${STATUS_LABEL[p.status].split(" ")[0]} ${p.display_name}`, `a:${report ? "r" : "p"}:${p.id}`).row();
  kb.text(fa.btnMenu, "a:m");
  await show(ctx, fa.peopleTitle, kb);
}

async function showPerson(ctx: Context, id: string) {
  const p = await getPerson(id);
  if (!p) return show(ctx, fa.noPeople, new InlineKeyboard().text(fa.btnBack, "a:l"));
  const meds = await getMeds(id);
  const medsText = meds.length ? meds.map((m) => fa.medListLine({ ...m, days: m.days_of_week })).join("\n") : fa.noMedsAdmin;
  const kb = new InlineKeyboard();
  if (p.status === "active") kb.text(fa.btnStop, `a:px:${id}`); else kb.text(fa.btnStart, `a:ps:${id}`);
  kb.row().text(fa.btnAddMed, `a:mn:${id}`).text(fa.btnInvite, `a:iv:${id}`).row();
  for (const m of meds) kb.text(`${m.is_active ? "💊" : "⏸"} ${m.name.slice(0, 24)}`, `a:mm:${m.id}`).row();
  kb.text(fa.btnReport, `a:r:${id}`).text(fa.btnEditPerson, `a:pe:${id}`).text(fa.btnDeletePerson, `a:pd:${id}`).row()
    .text(fa.btnBack, "a:l");
  await show(ctx, fa.personCard(p.display_name, p.timezone, STATUS_LABEL[p.status], medsText), kb);
}

async function showMed(ctx: Context, medId: number) {
  const m = await getMed(medId);
  if (!m) return show(ctx, fa.noMedsAdmin, menuKb());
  const kb = new InlineKeyboard()
    .text(m.is_active ? fa.btnPauseMed : fa.btnResumeMed, `a:mp:${m.id}`).text(fa.btnDeleteMed, `a:md:${m.id}`).row()
    .text(fa.btnEditMedName, `a:me:${m.id}:name`).text(fa.btnEditMedDose, `a:me:${m.id}:dose`).text(fa.btnEditMedTimes, `a:me:${m.id}:times`).row()
    .text(fa.btnEditMedDays, `a:me:${m.id}:days`).text(fa.btnEditMedEnd, `a:me:${m.id}:end`).text(fa.btnEditMedNote, `a:me:${m.id}:note`).row()
    .text(fa.btnBack, `a:p:${m.person_id}`);
  await show(ctx, `${fa.medSummary({ ...m, days: m.days_of_week, start: m.start_date, end: m.end_date })}\n\n${fa.medMenu}`, kb);
}

function daysKb(days: number[], toggle: (d: number) => string, done: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  DAY_ORDER.forEach((d, i) => {
    kb.text(`${days.includes(d) ? "✅" : "▫️"} ${DAY_SHORT[d]}`, toggle(d));
    if (i === 3) kb.row();
  });
  return kb.row().text(fa.btnDaysDone, done);
}

// ───────────────────────── reports ─────────────────────────
async function showReport(ctx: Context, personId: string) {
  const p = await getPerson(personId);
  if (!p) return;
  const nowLocal = DateTime.now().setZone(p.timezone);
  const ranges: [string, Date][] = [
    [fa.rToday, nowLocal.startOf("day").toJSDate()],
    [fa.r7, nowLocal.minus({ days: 7 }).toJSDate()],
    [fa.r30, nowLocal.minus({ days: 30 }).toJSDate()],
  ];
  const lines = [fa.reportTitle(p.display_name), ""];
  for (const [label, from] of ranges) {
    const r = await query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM dose_events WHERE person_id=$1 AND scheduled_for >= $2 GROUP BY status`, [personId, from]);
    const c = (s: string) => r.find((x) => x.status === s)?.n ?? 0;
    const taken = c("taken"), skipped = c("skipped"), missed = c("missed");
    const denom = taken + skipped + missed;
    lines.push(fa.reportRange(label, taken, skipped, missed, denom ? `${toFa(Math.round((taken / denom) * 100))}٪` : fa.noData));
  }
  const per = await query<{ name: string; status: string; n: number }>(
    `SELECT m.name, d.status, count(*)::int AS n FROM dose_events d
     JOIN medication_times mt ON mt.id=d.medication_time_id JOIN medications m ON m.id=mt.medication_id
     WHERE d.person_id=$1 AND d.scheduled_for >= $2 AND d.status IN ('taken','skipped','missed')
     GROUP BY m.name, d.status ORDER BY m.name`, [personId, ranges[2][1]]);
  if (per.length) {
    lines.push("", `<b>${fa.r30}</b>`);
    for (const name of [...new Set(per.map((x) => x.name))]) {
      const c = (s: string) => per.find((x) => x.name === name && x.status === s)?.n ?? 0;
      const d = c("taken") + c("skipped") + c("missed");
      lines.push(`💊 ${esc(name)}: ✅ ${toFa(c("taken"))} ✗ ${toFa(c("skipped"))} ⌛ ${toFa(c("missed"))} — ${d ? `${toFa(Math.round((c("taken") / d) * 100))}٪` : fa.noData}`);
    }
  }
  await show(ctx, lines.join("\n"), new InlineKeyboard().text(fa.btnBack, `a:p:${personId}`));
}

async function showStatus(ctx: Context) {
  const last = await kvGet<{ at: string }>("last_cron");
  const [s] = await query<{ sent: number; failed: number; pending: number; people: number }>(
    `SELECT (SELECT count(*) FROM dose_events WHERE sent_at > now() - interval '24 hours')::int AS sent,
            (SELECT count(*) FROM dose_events WHERE status IN ('send_failed','missed_system') AND created_at > now() - interval '24 hours')::int AS failed,
            (SELECT count(*) FROM dose_events WHERE status='sent')::int AS pending,
            (SELECT count(*) FROM people WHERE status='active')::int AS people`);
  const ago = last ? `${toFa(Math.round((Date.now() - +new Date(last.value.at)) / 60000))} دقیقه پیش` : fa.cronNever;
  await show(ctx, fa.statusText({ lastCron: ago, sentToday: s.sent, failedToday: s.failed, pending: s.pending, people: s.people }),
    new InlineKeyboard().text(fa.btnMenu, "a:m"));
}

// ───────────────────────── actions ─────────────────────────
async function startReminders(ctx: Context, id: string) {
  const p = await getPerson(id);
  if (!p) return;
  const err = p.status === "blocked" ? fa.startBlocked
    : !p.telegram_chat_id ? fa.startNotConnected
    : !(await getMeds(id)).some((m) => m.is_active && m.times.length) ? fa.startNoMeds : null;
  if (err) return void ctx.answerCallbackQuery({ text: err, show_alert: true }).catch(() => {});
  await query(`UPDATE people SET status='active', active_since=now(), resume_status=NULL, updated_at=now() WHERE id=$1`, [id]);
  await ctx.api.sendMessage(p.telegram_chat_id!, fa.remindersStarted).catch(() => {});
  await ctx.answerCallbackQuery({ text: fa.startedAdmin }).catch(() => {});
  await showPerson(ctx, id);
}

async function stopReminders(ctx: Context, id: string) {
  const p = await getPerson(id);
  if (!p) return;
  await query(`UPDATE people SET status='connected', resume_status=NULL, updated_at=now() WHERE id=$1 AND status IN ('active','paused')`, [id]);
  await cancelOpenDoses(ctx.api as any, id);
  if (p.telegram_chat_id) await ctx.api.sendMessage(p.telegram_chat_id, fa.remindersStopped).catch(() => {});
  await ctx.answerCallbackQuery({ text: fa.stoppedAdmin }).catch(() => {});
  await showPerson(ctx, id);
}

async function createInvite(ctx: Context, id: string) {
  const token = newToken();
  await tx(async (c) => {
    await c.query(`UPDATE invites SET revoked_at=now() WHERE person_id=$1 AND used_at IS NULL AND revoked_at IS NULL`, [id]);
    await c.query(`INSERT INTO invites (person_id, token_hash, expires_at) VALUES ($1,$2, now() + make_interval(hours => $3))`,
      [id, hashToken(token), config.inviteTtlHours]);
  });
  const url = `https://t.me/${ctx.me.username}?start=${token}`;
  await show(ctx, fa.inviteCreated(url), new InlineKeyboard().text(fa.btnRevoke, `a:ir:${id}`).row().text(fa.btnBack, `a:p:${id}`));
}

// ───────────────────────── flows ─────────────────────────
const tzKb = () => {
  const kb = new InlineKeyboard();
  const zones = [...new Set([config.defaultTimezone, "Europe/Rome", "Europe/London", "Europe/Berlin", "Asia/Dubai", "America/New_York"])];
  zones.forEach((z, i) => { kb.text(z, `a:tz:${z}`); if (i % 2) kb.row(); });
  return kb;
};
const cancelRow = (kb = new InlineKeyboard()) => kb.row().text(fa.btnCancel, "a:fx");

async function prompt(ctx: Context, st: FlowState) {
  const d = st.data;
  const send = (t: string, kb?: Kb) => ctx.reply(t, { ...H, reply_markup: cancelRow(kb) });
  switch (`${st.flow}.${st.step}`) {
    case "new_person.name": case "edit_person_name.value": return send(fa.askName);
    case "new_person.tz": case "edit_person_tz.value": return send(fa.askTz(config.defaultTimezone), tzKb());
    case "new_person.confirm":
      return send(fa.confirmPerson(d.name, d.tz), new InlineKeyboard().text(fa.btnConfirm, "a:fc"));
    case "new_med.name": return send(fa.askMedName);
    case "new_med.dose": return send(fa.askDose);
    case "new_med.times": return send(fa.askTimes);
    case "new_med.days": return send(fa.askDays, daysKb(d.days, (n) => `a:dy:${n}`, "a:dd"));
    case "new_med.start": return send(fa.askStart, new InlineKeyboard().text(fa.btnToday, "a:st"));
    case "new_med.end": return send(fa.askEnd, new InlineKeyboard().text(fa.btnNoEnd, "a:en"));
    case "new_med.note": return send(fa.askNote, new InlineKeyboard().text(fa.btnNoNote, "a:nn"));
    case "new_med.confirm":
      return send(`${fa.medSummary({ ...d, days: d.days } as any)}\n\n${fa.confirmMedQ}`, new InlineKeyboard().text(fa.btnConfirm, "a:fc"));
    case "edit_med.value": {
      const f = d.field as string;
      return send(
        f === "name" ? fa.askMedName : f === "dose" ? fa.askDose : f === "times" ? fa.askTimes : f === "end" ? fa.askEnd : fa.askNote,
        f === "end" ? new InlineKeyboard().text(fa.btnNoEnd, "a:en") : f === "note" ? new InlineKeyboard().text(fa.btnNoNote, "a:nn") : undefined);
    }
  }
}

type Input = { text?: string; action?: "tz" | "dy" | "dd" | "st" | "en" | "nn" | "fc"; value?: string };

async function advance(ctx: Context, st: FlowState, chat: number, inp: Input) {
  const d = st.data;
  const bad = (msg: string) => ctx.reply(msg, { ...H, reply_markup: msg === fa.tzInvalid ? cancelRow(tzKb()) : undefined });
  const next = async (step: string) => { st.step = step; await setState(chat, st.flow, step, d); await prompt(ctx, st); };
  const txt = inp.text?.trim();
  const short = (s: string | undefined, max = 80) => (s && s.length >= 1 && s.length <= max ? s : null);

  switch (`${st.flow}.${st.step}`) {
    case "new_person.name": { const n = short(txt, 50); if (!n) return bad(fa.nameInvalid); d.name = n; return next("tz"); }
    case "new_person.tz": {
      const z = inp.action === "tz" ? inp.value : txt;
      if (!z || !zoneOk(z)) return bad(fa.tzInvalid);
      d.tz = z; return next("confirm");
    }
    case "new_person.confirm": {
      if (inp.action !== "fc") return;
      const r = await query<{ id: string }>(
        `INSERT INTO people (display_name, timezone, created_by_admin_chat_id) VALUES ($1,$2,$3) RETURNING id`, [d.name, d.tz, chat]);
      await clearState(chat);
      await ctx.reply(fa.personCreated);
      return showPerson(ctx, r[0].id);
    }
    case "edit_person_name.value": {
      const n = short(txt, 50); if (!n) return bad(fa.nameInvalid);
      await query(`UPDATE people SET display_name=$2, updated_at=now() WHERE id=$1`, [d.personId, n]);
      await clearState(chat); await ctx.reply(fa.nameUpdated); return showPerson(ctx, d.personId);
    }
    case "edit_person_tz.value": {
      const z = inp.action === "tz" ? inp.value : txt;
      if (!z || !zoneOk(z)) return bad(fa.tzInvalid);
      await query(`UPDATE people SET timezone=$2, updated_at=now() WHERE id=$1`, [d.personId, z]);
      await clearState(chat); await ctx.reply(fa.tzUpdated); return showPerson(ctx, d.personId);
    }

    case "new_med.name": { const n = short(txt, 80); if (!n) return bad(fa.fieldInvalid); d.name = n; return next("dose"); }
    case "new_med.dose": { const n = short(txt, 80); if (!n) return bad(fa.fieldInvalid); d.dose = n; return next("times"); }
    case "new_med.times": { const t = txt ? parseTimes(txt) : null; if (!t) return bad(fa.timesInvalid); d.times = t; d.days = [0, 1, 2, 3, 4, 5, 6]; return next("days"); }
    case "new_med.days": {
      if (inp.action === "dy") {
        const n = Number(inp.value);
        d.days = d.days.includes(n) ? d.days.filter((x: number) => x !== n) : [...d.days, n].sort();
        await setState(chat, st.flow, st.step, d);
        return void ctx.editMessageReplyMarkup({ reply_markup: cancelRow(daysKb(d.days, (x) => `a:dy:${x}`, "a:dd")) }).catch(() => {});
      }
      if (inp.action === "dd") {
        if (!d.days.length) return void ctx.answerCallbackQuery({ text: fa.askDays, show_alert: true }).catch(() => {});
        return next("start");
      }
      return;
    }
    case "new_med.start": {
      const tz = (await getPerson(d.personId))?.timezone ?? config.defaultTimezone;
      const v = inp.action === "st" ? DateTime.now().setZone(tz).toISODate() : txt ? parseDate(txt) : null;
      if (!v) return bad(fa.dateInvalid);
      d.start = v; return next("end");
    }
    case "new_med.end": {
      if (inp.action === "en") d.end = null;
      else { const v = txt ? parseDate(txt) : null; if (!v) return bad(fa.dateInvalid); if (v < d.start) return bad(fa.endBeforeStart); d.end = v; }
      return next("note");
    }
    case "new_med.note": {
      if (inp.action === "nn") d.note = null;
      else { const n = short(txt, 120); if (!n) return bad(fa.fieldInvalid); d.note = n; }
      return next("confirm");
    }
    case "new_med.confirm": {
      if (inp.action !== "fc") return;
      await tx(async (c) => {
        const m = (await c.query(
          `INSERT INTO medications (person_id,name,dose,note,days_of_week,start_date,end_date) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [d.personId, d.name, d.dose, d.note, d.days, d.start, d.end])).rows[0];
        await setMedTimes(m.id, d.times, c);
      });
      await clearState(chat); await ctx.reply(fa.medSaved); return showPerson(ctx, d.personId);
    }

    case "edit_med.value": {
      const f = d.field as string;
      if (f === "times") {
        const t = txt ? parseTimes(txt) : null; if (!t) return bad(fa.timesInvalid);
        await tx((c) => setMedTimes(d.medId, t, c));
      } else if (f === "end") {
        let v: string | null = null;
        if (inp.action !== "en") { v = txt ? parseDate(txt) : null; if (!v) return bad(fa.dateInvalid); }
        await query(`UPDATE medications SET end_date=$2, is_active = CASE WHEN $2::date IS NULL OR $2::date >= CURRENT_DATE - 1 THEN true ELSE is_active END WHERE id=$1`, [d.medId, v]);
      } else if (f === "note") {
        const v = inp.action === "nn" ? null : short(txt, 120); if (inp.action !== "nn" && !v) return bad(fa.fieldInvalid);
        await query(`UPDATE medications SET note=$2 WHERE id=$1`, [d.medId, v]);
      } else {
        const v = short(txt, 80); if (!v) return bad(fa.fieldInvalid);
        await query(`UPDATE medications SET ${f === "name" ? "name" : "dose"}=$2 WHERE id=$1`, [d.medId, v]);
      }
      await clearState(chat); await ctx.reply(fa.medUpdated); return showMed(ctx, d.medId);
    }
  }
}

// ───────────────────────── registration ─────────────────────────
export function registerAdmin(bot: Bot<Context>) {
  const guard = (fn: (ctx: Context) => Promise<unknown>) => async (ctx: Context) => {
    if (!isAdmin(ctx.chat?.id)) return void ctx.reply(fa.denied);
    await fn(ctx);
  };

  bot.command("admin", guard(showMenu));
  bot.command("people", guard((c) => showPeople(c)));
  bot.command("report", guard((c) => showPeople(c, true)));
  bot.command("status", guard(showStatus));
  bot.command("cancel", async (ctx) => {
    if (!isAdmin(ctx.chat.id) || !(await getState(ctx.chat.id))) return void ctx.reply(fa.nothingToCancel);
    await clearState(ctx.chat.id);
    await ctx.reply(fa.flowCancelled);
  });

  // All admin buttons carry the "a:" prefix and are re-checked here (no forged callbacks).
  bot.callbackQuery(/^a:/, async (ctx) => {
    const chat = ctx.chat?.id;
    if (!isAdmin(chat)) return void ctx.answerCallbackQuery({ text: fa.denied, show_alert: true }).catch(() => {});
    const [, cmd, arg, arg2] = ctx.callbackQuery.data.split(":");
    const medId = Number(arg);
    const noAnswerYet = ["ps"].includes(cmd) || ["px"].includes(cmd); // these answer with a toast themselves
    if (!noAnswerYet) await ctx.answerCallbackQuery().catch(() => {});

    switch (cmd) {
      case "m": return showMenu(ctx);
      case "l": return showPeople(ctx);
      case "ss": return showStatus(ctx);
      case "np": await clearState(chat!); await setState(chat!, "new_person", "name", {}); return prompt(ctx, { flow: "new_person", step: "name", data: {} });
      case "p": return showPerson(ctx, arg);
      case "ps": return startReminders(ctx, arg);
      case "px": return stopReminders(ctx, arg);
      case "r": return showReport(ctx, arg);
      case "pe": return show(ctx, fa.btnEditPerson, new InlineKeyboard().text(fa.btnEditName, `a:pen:${arg}`).text(fa.btnEditTz, `a:pet:${arg}`).row().text(fa.btnBack, `a:p:${arg}`));
      case "pen": case "pet": {
        const flow = cmd === "pen" ? "edit_person_name" : "edit_person_tz";
        await setState(chat!, flow, "value", { personId: arg });
        return prompt(ctx, { flow, step: "value", data: { personId: arg } });
      }
      case "pd": return show(ctx, fa.deletePersonAsk((await getPerson(arg))?.display_name ?? ""), new InlineKeyboard().text(fa.yesDelete, `a:pd2:${arg}`).text(fa.btnCancel, `a:p:${arg}`));
      case "pd2": return show(ctx, fa.deletePersonFinal((await getPerson(arg))?.display_name ?? ""), new InlineKeyboard().text(fa.yesDelete, `a:pd3:${arg}`).text(fa.btnCancel, `a:p:${arg}`));
      case "pd3": { // hard delete: ON DELETE CASCADE removes meds, times, doses, invites, audit log
        await query(`DELETE FROM people WHERE id=$1`, [arg]);
        await show(ctx, fa.deletePersonDone, new InlineKeyboard().text(fa.btnPeople, "a:l"));
        return;
      }
      case "mn": {
        const data = { personId: arg };
        await clearState(chat!); await setState(chat!, "new_med", "name", data);
        return prompt(ctx, { flow: "new_med", step: "name", data });
      }
      case "mm": return showMed(ctx, medId);
      case "mp": {
        await query(`UPDATE medications SET is_active = NOT is_active WHERE id=$1`, [medId]);
        return showMed(ctx, medId);
      }
      case "md": return show(ctx, fa.confirmDeleteMedQ, new InlineKeyboard().text(fa.yesDelete, `a:md2:${medId}`).text(fa.btnCancel, `a:mm:${medId}`));
      case "md2": {
        const m = await getMed(medId);
        await query(`DELETE FROM medications WHERE id=$1`, [medId]);
        return m ? showPerson(ctx, m.person_id) : showMenu(ctx);
      }
      case "me": {
        if (arg2 === "days") return showDaysEditor(ctx, medId);
        const data = { medId, field: arg2 };
        await setState(chat!, "edit_med", "value", data);
        return prompt(ctx, { flow: "edit_med", step: "value", data });
      }
      case "ed": { // toggle a weekday directly on a stored medication; arg=medId, arg2=day
        const m = await getMed(medId); if (!m) return;
        const day = Number(arg2);
        const days = m.days_of_week.includes(day) ? m.days_of_week.filter((x) => x !== day) : [...m.days_of_week, day].sort();
        if (!days.length) return void ctx.answerCallbackQuery({ text: fa.askDays, show_alert: true }).catch(() => {});
        await query(`UPDATE medications SET days_of_week=$2 WHERE id=$1`, [medId, days]);
        return showDaysEditor(ctx, medId);
      }
      case "iv": {
        const p = await getPerson(arg);
        if (p?.telegram_chat_id) return show(ctx, fa.inviteExisting, new InlineKeyboard().text(fa.btnConfirm, `a:iv2:${arg}`).text(fa.btnCancel, `a:p:${arg}`));
        return createInvite(ctx, arg);
      }
      case "iv2": return createInvite(ctx, arg);
      case "ir": {
        const r = await query(`UPDATE invites SET revoked_at=now() WHERE person_id=$1 AND used_at IS NULL AND revoked_at IS NULL RETURNING id`, [arg]);
        return show(ctx, r.length ? fa.inviteRevoked : fa.inviteNone, new InlineKeyboard().text(fa.btnBack, `a:p:${arg}`));
      }
      // ── flow buttons ──
      case "fx": await clearState(chat!); return show(ctx, fa.flowCancelled, menuKb());
      case "tz": case "dy": case "dd": case "st": case "en": case "nn": case "fc": {
        const s = await getState(chat!);
        if (!s) return void ctx.reply(fa.flowExpired);
        return advance(ctx, s, chat!, { action: cmd as Input["action"], value: arg });
      }
    }
  });

  // Free-text answers to flow questions.
  bot.on("message:text", async (ctx, next) => {
    if (ctx.message.text.startsWith("/")) return next();
    const chat = ctx.chat.id;
    if (!isAdmin(chat)) return void ctx.reply(fa.unknownCmd);
    const st = await getState(chat);
    if (!st) return void ctx.reply(fa.unknownCmd);
    await advance(ctx, st, chat, { text: ctx.message.text });
  });
}

async function showDaysEditor(ctx: Context, medId: number) {
  const m = await getMed(medId);
  if (!m) return;
  await show(ctx, `${fa.askDays}\n${daysLabel(m.days_of_week)}`,
    daysKb(m.days_of_week, (d) => `a:ed:${medId}:${d}`, `a:mm:${medId}`));
}
