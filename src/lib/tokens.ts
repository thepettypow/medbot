import { createHash, randomBytes } from "node:crypto";

/** 24 random bytes = 192 bits, base64url => 32 chars (fits Telegram's start payload). */
export const newToken = () => randomBytes(24).toString("base64url");
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
