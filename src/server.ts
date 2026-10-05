import { createServer } from "node:http";
import { getBot } from "@/bot";
import { config } from "@/lib/config";
import { pool, query } from "@/lib/db";
import { startScheduler } from "@/scheduler";

let shuttingDown = false;
const bot = getBot();
const scheduler = startScheduler(bot.api as any);

// Optional local health endpoint for an uptime monitor / reverse proxy.
const health = config.healthPort
  ? createServer(async (req, res) => {
      if (req.url !== "/health") return void res.writeHead(404).end();
      const last = scheduler.lastTickAt();
      const tickAgeSec = last ? Math.round((Date.now() - +last) / 1000) : null;
      let db = false;
      try { await query("SELECT 1"); db = true; } catch {}
      const ok = db && tickAgeSec !== null && tickAgeSec < 180;
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify({ ok, db, tickAgeSec }));
    }).listen(config.healthPort, config.healthHost, () => console.log("health on", `${config.healthHost}:${config.healthPort}`))
  : null;

// Long polling: no domain, TLS or webhook needed. start() also removes any old webhook.
bot.start({
  allowed_updates: ["message", "callback_query", "my_chat_member"],
  onStart: (me) => console.log("bot started", { username: me.username }),
}).catch((e) => {
  if (shuttingDown) return;
  console.error("bot polling stopped", { message: e?.message, code: e?.error_code });
  process.exit(1);
});

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("shutting down", { signal });
  const force = setTimeout(() => process.exit(1), 20_000).unref();
  await bot.stop().catch(() => {});
  await scheduler.stop();
  health?.close();
  await pool().end().catch(() => {});
  clearTimeout(force);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (e: any) => console.error("unhandled rejection", { message: e?.message }));
