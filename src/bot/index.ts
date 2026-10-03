import { Bot, GrammyError } from "grammy";
import { config } from "@/lib/config";
import { fa } from "@/i18n/fa";
import { registerAdmin } from "./admin";
import { registerDoseCallbacks } from "./doses";
import { registerPatient } from "./patient";

const g = globalThis as unknown as { __bot?: Bot };

export function getBot(): Bot {
  if (g.__bot) return g.__bot;
  const bot = new Bot(config.botToken);

  // Never log message text, names or medications: IDs and error codes only.
  bot.catch((err) => {
    const e = err.error;
    console.error("bot error", {
      update: err.ctx.update.update_id,
      code: e instanceof GrammyError ? e.error_code : undefined,
      // error text can echo user input (names, doses) => log only the error type/code
      kind: e instanceof Error ? e.name : "unknown",
      pg: (e as any)?.code,
    });
    err.ctx.reply(fa.error).catch(() => {});
  });

  registerDoseCallbacks(bot);
  registerPatient(bot);
  registerAdmin(bot);
  return (g.__bot = bot);
}
