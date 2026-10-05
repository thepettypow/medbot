import { timingSafeEqual } from "node:crypto";
import { config } from "./config";

export function cronAuthorized(req: Request): boolean {
  const header = req.headers.get("authorization");
  const got = Buffer.from(header ?? "");
  const want = Buffer.from(`Bearer ${config.cronSecret}`);
  const ok = got.length === want.length && timingSafeEqual(got, want);
  if (!ok) {
    // Never log the secret itself; the reason is enough to spot a mismatched CRON_SECRET.
    console.warn("cron unauthorized", { path: new URL(req.url).pathname, hasAuthHeader: !!header });
  }
  return ok;
}
