// Usage: BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/set-webhook.mjs https://your-app.vercel.app
const base = process.argv[2];
const { BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET } = process.env;
if (!base || !BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET) {
  console.error("usage: BOT_TOKEN=.. TELEGRAM_WEBHOOK_SECRET=.. node scripts/set-webhook.mjs <https-base-url>");
  process.exit(1);
}
const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url: `${base.replace(/\/$/, "")}/api/telegram`,
    secret_token: TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query", "my_chat_member"],
    drop_pending_updates: true,
  }),
});
console.log(await res.json());
