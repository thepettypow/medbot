import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { msUntilNextTick, startScheduler, TICK_OFFSET_MS } from "../src/scheduler";

const quiet = { log: () => {}, error: () => {} };

describe("scheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("aligns ticks to just after the minute boundary", () => {
    const t = Date.UTC(2026, 9, 5, 8, 29, 40, 0);
    expect(msUntilNextTick(t)).toBe(20_000 + TICK_OFFSET_MS);
    expect(msUntilNextTick(Date.UTC(2026, 9, 5, 8, 30, 0, 0))).toBe(60_000 + TICK_OFFSET_MS);
  });

  it("runs on boot, then once per minute at hh:mm:00.300, never overlapping", async () => {
    vi.setSystemTime(Date.UTC(2026, 9, 5, 8, 29, 40));
    const at: string[] = [];
    let inFlight = 0, maxInFlight = 0;
    const s = startScheduler({} as any, {
      remind: async (_api, now) => {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        at.push(now.toISOString());
        await new Promise((r) => setTimeout(r, 1000));
        inFlight--;
      },
      cleanup: async () => {},
      log: quiet,
    });
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    await s.stop();
    expect(at).toEqual([
      "2026-10-05T08:29:40.000Z",
      "2026-10-05T08:30:00.300Z",
      "2026-10-05T08:31:00.300Z",
      "2026-10-05T08:32:00.300Z",
    ]);
    expect(maxInFlight).toBe(1);
  });

  it("keeps ticking after a failed run and runs cleanup on its own cadence", async () => {
    vi.setSystemTime(Date.UTC(2026, 9, 5, 0, 0, 30));
    let n = 0, cleanups = 0;
    const s = startScheduler({} as any, {
      remind: async () => { if (n++ === 1) throw new Error("db down"); },
      cleanup: async () => { cleanups++; },
      log: quiet,
    });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await s.stop();
    expect(n).toBe(6);
    expect(cleanups).toBe(1); // boot only; next is 6 h later
    expect(s.lastTickAt()).not.toBeNull();
  });

  it("stop() waits for the in-flight tick and schedules nothing after", async () => {
    vi.setSystemTime(Date.UTC(2026, 9, 5, 0, 0, 30));
    let n = 0;
    const s = startScheduler({} as any, { remind: async () => { n++; }, cleanup: async () => {}, log: quiet });
    await vi.advanceTimersByTimeAsync(0);
    await s.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(n).toBe(1);
  });
});
