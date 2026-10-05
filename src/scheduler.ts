import { config } from "@/lib/config";
import { runRemind } from "@/engine/remind";
import { runCleanup } from "@/engine/cleanup";
import type { TgApi } from "@/engine/types";

/**
 * In-process clock. Dose times are whole minutes, so the remind tick fires just after every
 * minute boundary (hh:mm:00 + TICK_OFFSET_MS): a 12:00 dose goes out at ~12:00:00.
 * Ticks never overlap; if one runs long, the next waits for the following boundary.
 * The DB stays the source of truth and the idempotency gate, so a restart or a second
 * instance can never double-send.
 */
export const TICK_OFFSET_MS = 300;

export function msUntilNextTick(nowMs: number, offsetMs = TICK_OFFSET_MS): number {
  const next = Math.floor(nowMs / 60_000) * 60_000 + 60_000 + offsetMs;
  return next - nowMs;
}

export interface Scheduler {
  stop(): Promise<void>;
  lastTickAt(): Date | null;
}

export function startScheduler(
  api: TgApi,
  opts: {
    remind?: (api: TgApi, now: Date) => Promise<unknown>;
    cleanup?: (api: TgApi, now: Date) => Promise<unknown>;
    clock?: () => number;
    log?: Pick<Console, "log" | "error">;
  } = {},
): Scheduler {
  const remind = opts.remind ?? ((a, now) => runRemind(a, now));
  const cleanup = opts.cleanup ?? ((a, now) => runCleanup(a, now));
  const clock = opts.clock ?? Date.now;
  const log = opts.log ?? console;

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();
  let lastTick: Date | null = null;
  let lastCleanup = 0;

  const tick = async () => {
    const now = new Date(clock());
    const t0 = clock();
    try {
      const stats = await remind(api, now);
      lastTick = now;
      const lateMs = t0 - Math.floor(t0 / 60_000) * 60_000;
      log.log("tick", { at: now.toISOString(), lateMs, ms: clock() - t0, ...(stats as object) });
    } catch (e: any) {
      log.error("tick failed", { message: e?.message, code: e?.code });
    }
    if (+now - lastCleanup >= config.cleanupEveryMin * 60_000) {
      lastCleanup = +now;
      try {
        log.log("cleanup", await cleanup(api, now));
      } catch (e: any) {
        log.error("cleanup failed", { message: e?.message, code: e?.code });
      }
    }
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      running = tick().finally(schedule);
    }, msUntilNextTick(clock()));
  };

  // Catch up immediately on boot (doses inside the due window still go out), then align to the minute.
  running = tick().finally(schedule);

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
    lastTickAt: () => lastTick,
  };
}
