import { webhookCallback } from "grammy";
import { config } from "@/lib/config";
import { getBot } from "@/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// grammY verifies X-Telegram-Bot-Api-Secret-Token and answers 401 on mismatch.
export async function POST(req: Request) {
  const handler = webhookCallback(getBot(), "std/http", { secretToken: config.webhookSecret });
  return handler(req);
}
