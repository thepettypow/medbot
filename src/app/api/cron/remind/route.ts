import { cronAuthorized } from "@/lib/cron-auth";
import { getBot } from "@/bot";
import { runRemind } from "@/engine/remind";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const t0 = Date.now();
  try {
    const stats = await runRemind(getBot().api as any);
    console.log("cron remind", { ...stats, ms: Date.now() - t0 });
    return Response.json({ ok: true, ...stats });
  } catch (e: any) {
    console.error("cron remind failed", { message: e?.message, stack: e?.stack });
    return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
