import { cronAuthorized } from "@/lib/cron-auth";
import { getBot } from "@/bot";
import { runRemind } from "@/engine/remind";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  const stats = await runRemind(getBot().api as any);
  return Response.json({ ok: true, ...stats });
}
