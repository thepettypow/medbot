import { cronAuthorized } from "@/lib/cron-auth";
import { getBot } from "@/bot";
import { runCleanup } from "@/engine/cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  try {
    const res = await runCleanup(getBot().api as any);
    console.log("cron cleanup", res);
    return Response.json({ ok: true, ...res });
  } catch (e: any) {
    console.error("cron cleanup failed", { message: e?.message, stack: e?.stack });
    return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
