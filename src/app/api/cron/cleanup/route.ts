import { cronAuthorized } from "@/lib/cron-auth";
import { getBot } from "@/bot";
import { runCleanup } from "@/engine/cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response("unauthorized", { status: 401 });
  return Response.json({ ok: true, ...(await runCleanup(getBot().api as any)) });
}
