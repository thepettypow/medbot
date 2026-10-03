import { timingSafeEqual } from "node:crypto";
import { config } from "./config";

export function cronAuthorized(req: Request): boolean {
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${config.cronSecret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
