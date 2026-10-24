import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApifyError } from "@/lib/apify/errors";
import { __resetApifyGuardForTests, guardedRun } from "@/lib/apify/guard";
import type { CarListing } from "@/lib/types";
import { LIVE_CFG } from "./fixtures";

const LISTING = { id: "at_1" } as CarListing;
const cfg = (overrides: Partial<typeof LIVE_CFG> = {}) => ({ ...LIVE_CFG, ...overrides });

let now = 1_000_000_000;
beforeEach(() => {
  __resetApifyGuardForTests();
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function refused(promise: Promise<unknown>): Promise<ApifyError> {
  const err: ApifyError = await promise.then(
    () => {
      throw new Error("expected the guard to refuse");
    },
    (e: ApifyError) => e,
  );
  expect(err).toBeInstanceOf(ApifyError);
  expect(err.kind).toBe("budget");
  expect(err.retryAfterSeconds).toBeGreaterThan(0);
  return err;
}

describe("guardedRun", () => {
  it("reuses a fresh result for an identical search, empty results included", async () => {
    const run = vi.fn(async () => [LISTING]);
    await guardedRun(cfg(), "a", run);
    expect(await guardedRun(cfg(), "a", run)).toEqual([LISTING]);
    expect(run).toHaveBeenCalledTimes(1);

    const empty = vi.fn(async () => []);
    await guardedRun(cfg(), "b", empty);
    await guardedRun(cfg(), "b", empty);
    expect(empty).toHaveBeenCalledTimes(1);
  });

  it("runs again once the cache entry expires, or never caches with TTL 0", async () => {
    const run = vi.fn(async () => [LISTING]);
    await guardedRun(cfg(), "a", run);
    now += 901_000;
    await guardedRun(cfg(), "a", run);
    expect(run).toHaveBeenCalledTimes(2);

    const uncached = vi.fn(async () => [LISTING]);
    await guardedRun(cfg({ cacheTtlSecs: 0 }), "c", uncached);
    await guardedRun(cfg({ cacheTtlSecs: 0 }), "c", uncached);
    expect(uncached).toHaveBeenCalledTimes(2);
  });

  it("hands out copies, so callers can't change the cached result", async () => {
    const first = await guardedRun(cfg(), "a", async () => [{ ...LISTING }]);
    first[0].id = "changed";
    expect((await guardedRun(cfg(), "a", async () => []))[0].id).toBe("at_1");
  });

  it("shares one run between identical concurrent searches", async () => {
    let finish!: (l: CarListing[]) => void;
    const run = vi.fn(() => new Promise<CarListing[]>((resolve) => (finish = resolve)));
    const a = guardedRun(cfg(), "a", run);
    const b = guardedRun(cfg(), "a", run);
    finish([LISTING]);
    expect(await Promise.all([a, b])).toEqual([[LISTING], [LISTING]]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not cache failures, but counts them against the limits", async () => {
    const failing = vi.fn(async () => {
      throw new Error("boom");
    });
    const limits = cfg({ maxRunsPerHour: 2 });
    await expect(guardedRun(limits, "a", failing)).rejects.toThrow("boom");
    await expect(guardedRun(limits, "a", failing)).rejects.toThrow("boom");
    await refused(guardedRun(limits, "a", failing));
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("limits started runs per rolling hour", async () => {
    const limits = cfg({ maxRunsPerHour: 2, cacheTtlSecs: 0 });
    const run = vi.fn(async () => [LISTING]);
    await guardedRun(limits, "a", run);
    now += 1000;
    await guardedRun(limits, "b", run);
    const err = await refused(guardedRun(limits, "c", run));
    expect(err.retryAfterSeconds).toBe(3599);
    expect(err.userMessage).toMatch(/busy/);

    now += 3600_000;
    await guardedRun(limits, "c", run);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("books each run's full maxChargeUsd against the 24 h budget", async () => {
    const limits = cfg({ maxChargeUsd: 0.5, dailyBudgetUsd: 1, maxRunsPerHour: 100, cacheTtlSecs: 0 });
    const run = vi.fn(async () => [LISTING]);
    await guardedRun(limits, "a", run);
    await guardedRun(limits, "b", run);
    const err = await refused(guardedRun(limits, "c", run));
    expect(err.retryAfterSeconds).toBe(86_400);

    now += 86_400_001;
    await guardedRun(limits, "c", run);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("limits runs in flight", async () => {
    const limits = cfg({ maxConcurrentRuns: 1 });
    let finish!: (l: CarListing[]) => void;
    const slow = guardedRun(limits, "a", () => new Promise<CarListing[]>((resolve) => (finish = resolve)));
    await refused(guardedRun(limits, "b", async () => [LISTING]));
    finish([LISTING]);
    await slow;
    await expect(guardedRun(limits, "b", async () => [LISTING])).resolves.toEqual([LISTING]);
  });

  it("serves a cached search even when the limits are used up", async () => {
    const limits = cfg({ maxRunsPerHour: 1 });
    await guardedRun(limits, "a", async () => [LISTING]);
    await refused(guardedRun(limits, "b", async () => [LISTING]));
    await expect(guardedRun(limits, "a", async () => [])).resolves.toEqual([LISTING]);
  });
});
