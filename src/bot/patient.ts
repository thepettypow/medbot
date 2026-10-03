import { InlineKeyboard, type Bot, type Context } from "grammy";
import { config, isAdmin } from "@/lib/config";
import { query, tx } from "@/lib/db";
import { hashToken } from "@/lib/tokens";
import { cancelOpenDoses, markBlocked, unblock } from "@/engine/people";
import { esc, fa } from "@/i18n/fa";
import { getMeds, getPersonByChat } from "./queries";

const H = { parse_mode: "HTML" as const };

export async function medsText(personId: string): Promise<string> {
  const meds = (await getMeds(personId)).filter((m) => m.is_active);
  if (!meds.length) return fa.noMeds;
  return [fa.medsHeader, ...meds.map((m) => fa.medListLine({ ...m, days: m.days_of_week }))].join("\n");
}

export function registerPatient(bot: Bot<Context>) {
  bot.command("start", async (ctx) => {
    const chat = ctx.chat.id;
    const token = (ctx.match ?? "").trim();
    if (!token) {
      const p = await getPersonByChat(chat);
      if (p) {
        if (p.status === "blocked") await unblock(ctx.api as any, p.id);
        return void ctx.reply(`${fa.welcomeBack(p.display_name)}\n\n${fa.disclaimer}`, H);
      }
      return void ctx.reply(isAdmin(chat) ? "/admin" : fa.needInvite);
    }
    const inv = (await query(
      `SELECT i.id, i.used_at, i.revoked_at, i.expires_at, p.display_name
       FROM invites i JOIN people p ON p.id=i.person_id WHERE i.token_hash=$1`, [hashToken(token)]))[0];
    if (!inv || inv.revoked_at || new Date(inv.expires_at) < new Date()) return void ctx.reply(fa.inviteInvalid);
    if (inv.used_at) return void ctx.reply(fa.inviteUsed);
    const kb = new InlineKeyboard().text(fa.agree, `c:y:${inv.id}`).text(fa.decline, `c:n:${inv.id}`);
    await ctx.reply(`${fa.welcomeConsent(inv.display_name)}\n\n${fa.disclaimer}\n\n${fa.consentText}`, { ...H, reply_markup: kb });
  });

  bot.callbackQuery(/^c:([yn]):(\d+)$/, async (ctx) => {
    const [, ans, idStr] = ctx.match as unknown as string[];
    const chat = ctx.chat!.id;
    const invId = Number(idStr);
    await ctx.answerCallbackQuery().catch(() => {});

    if (ans === "n") {
      const r = (await query(
        `SELECT p.display_name, p.created_by_admin_chat_id AS admin FROM invites i JOIN people p ON p.id=i.person_id WHERE i.id=$1`, [invId]))[0];
      await ctx.editMessageText(fa.declined).catch(() => {});
      if (r) await ctx.api.sendMessage(r.admin, fa.notifyDeclined(r.display_name), H).catch(() => {}); // invite not burned
      return;
    }

    type Res = { ok: false; reason: "invalid" | "used" | "taken" } | { ok: true; personId: string; name: string; admin: number; status: string; moved: boolean };
    const res: Res = await tx(async (c): Promise<Res> => {
      const i = (await c.query(
        `SELECT i.*, p.display_name, p.status, p.telegram_chat_id AS old_chat, p.created_by_admin_chat_id AS admin
         FROM invites i JOIN people p ON p.id=i.person_id WHERE i.id=$1 FOR UPDATE OF i`, [invId])).rows[0];
      if (!i || i.revoked_at || new Date(i.expires_at) < new Date()) return { ok: false, reason: "invalid" };
      if (i.used_at) return { ok: false, reason: "used" };
      const clash = (await c.query(`SELECT 1 FROM people WHERE telegram_chat_id=$1 AND id<>$2`, [chat, i.person_id])).rows[0];
      if (clash) return { ok: false, reason: "taken" };
      await c.query(`UPDATE invites SET used_at=now() WHERE id=$1`, [invId]);
      const upd = (await c.query(
        `UPDATE people SET telegram_chat_id=$1, consent_at=now(), consent_version=$2, resume_status=NULL, updated_at=now(),
                status = CASE WHEN status IN ('active','paused') THEN status ELSE 'connected' END
         WHERE id=$3 RETURNING status`, [chat, config.consentVersion, i.person_id])).rows[0];
      return { ok: true, personId: i.person_id, name: i.display_name, admin: i.admin, status: upd.status, moved: i.old_chat != null && Number(i.old_chat) !== chat };
    });

    if (!res.ok) {
      return void ctx.editMessageText(res.reason === "taken" ? fa.chatAlreadyLinked : res.reason === "used" ? fa.inviteUsed : fa.inviteInvalid).catch(() => {});
    }
    if (res.moved) await cancelOpenDoses(null, res.personId); // old chat's unanswered doses are void
    await ctx.editMessageText(fa.connectedOk).catch(() => {});
    await ctx.reply(`${await medsText(res.personId)}\n\n${fa.medsConfirmQ}\n\n${res.status === "active" ? "" : fa.remindersWillStart}`.trim());
    await ctx.api.sendMessage(res.admin, fa.notifyConnected(res.name), H).catch(() => {});
  });

  bot.command("mymeds", async (ctx) => {
    const p = await getPersonByChat(ctx.chat.id);
    if (!p) return void ctx.reply(fa.notLinked);
    await ctx.reply(await medsText(p.id), H);
  });

  bot.command("privacy", (ctx) => ctx.reply(fa.privacy, H));
  bot.command("help", (ctx) => ctx.reply(`${fa.helpPatient}\n\n${fa.disclaimer}`));

  // ── settings: self pause / resume ──
  bot.command("settings", async (ctx) => {
    const p = await getPersonByChat(ctx.chat.id);
    if (!p) return void ctx.reply(fa.notLinked);
    const kb = new InlineKeyboard();
    if (p.status === "active") kb.text(fa.pauseBtn, "p:z");
    else if (p.status === "paused") kb.text(fa.resumeBtn, "p:r");
    else return void ctx.reply(fa.settingsNeedAdmin);
    await ctx.reply(fa.settingsTitle, { reply_markup: kb });
  });
  bot.callbackQuery("p:z", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const p = await getPersonByChat(ctx.chat!.id);
    if (!p || p.status !== "active") return;
    await query(`UPDATE people SET status='paused', resume_status='active', updated_at=now() WHERE id=$1 AND status='active'`, [p.id]);
    await cancelOpenDoses(ctx.api as any, p.id);
    await ctx.editMessageText(fa.paused).catch(() => {});
  });
  bot.callbackQuery("p:r", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const p = await getPersonByChat(ctx.chat!.id);
    if (!p || p.status !== "paused") return;
    await query(`UPDATE people SET status='active', resume_status=NULL, active_since=now(), updated_at=now() WHERE id=$1 AND status='paused'`, [p.id]);
    await ctx.editMessageText(fa.resumed).catch(() => {});
  });

  // ── hard delete (two-step) ──
  bot.command("delete_my_data", async (ctx) => {
    const p = await getPersonByChat(ctx.chat.id);
    if (!p) return void ctx.reply(fa.notLinked);
    await ctx.reply(fa.deleteAsk, { reply_markup: new InlineKeyboard().text(fa.deleteYes, "d:1").text(fa.deleteNo, "d:n") });
  });
  bot.callbackQuery("d:n", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.editMessageText(fa.deleteCancelled).catch(() => {});
  });
  bot.callbackQuery("d:1", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.editMessageText(fa.deleteStep2, { reply_markup: new InlineKeyboard().text(fa.deleteFinal, "d:2").text(fa.deleteNo, "d:n") }).catch(() => {});
  });
  bot.callbackQuery("d:2", async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    // ON DELETE CASCADE removes medications, times, doses, invites, audit log.
    const r = (await query(`DELETE FROM people WHERE telegram_chat_id=$1 RETURNING display_name, created_by_admin_chat_id AS admin`, [ctx.chat!.id]))[0];
    await ctx.editMessageText(fa.deleteDone).catch(() => {});
    if (r) await ctx.api.sendMessage(r.admin, fa.notifyDeleted(r.display_name), H).catch(() => {});
  });

  // ── user blocks / unblocks the bot ──
  bot.on("my_chat_member", async (ctx) => {
    const u = ctx.myChatMember;
    if (u.chat.type !== "private") return;
    const p = await getPersonByChat(u.chat.id);
    if (!p) return;
    if (u.new_chat_member.status === "kicked") await markBlocked(ctx.api as any, p.id);
    else if (u.new_chat_member.status === "member" && p.status === "blocked") await unblock(ctx.api as any, p.id);
  });
}
