import type { LiveApifyConfig } from "@/lib/apify/config";
import { ApifyError, LISTINGS_BUSY } from "@/lib/apify/errors";
import type { CarListing } from "@/lib/types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_CACHE_ENTRIES = 100;

interface GuardState {
  /** Start time and worst-case cost of every paid run in the last 24 h. */
  starts: { at: number; reservedUsd: number }[];
  active: number;
  cache: Map<string, { at: number; listings: CarListing[] }>;
  inflight: Map<string, Promise<CarListing[]>>;
}

// Kept on globalThis so dev-server module reloads don't reset the counters.
const store = globalThis as typeof globalThis & { __secondGearApifyGuard?: GuardState };

function state(): GuardState {
  store.__secondGearApifyGuard ??= { starts: [], active: 0, cache: new Map(), inflight: new Map() };
  return store.__secondGearApifyGuard;
}

const busy = (detail: string, retryAfterSeconds: number) =>
  new ApifyError("budget", LISTINGS_BUSY, { detail, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)) });

/** Throws `budget` when another paid run would break a limit; otherwise books the run. */
function reserveRun(cfg: LiveApifyConfig, now: number): void {
  const s = state();
  s.starts = s.starts.filter((r) => r.at > now - DAY_MS);

  if (s.active >= cfg.maxConcurrentRuns) throw busy(`concurrent runs ${s.active}/${cfg.maxConcurrentRuns}`, 30);

  const lastHour = s.starts.filter((r) => r.at > now - HOUR_MS);
  if (lastHour.length >= cfg.maxRunsPerHour) {
    throw busy(`runs this hour ${lastHour.length}/${cfg.maxRunsPerHour}`, (lastHour[0].at + HOUR_MS - now) / 1000);
  }

  const reserved = s.starts.reduce((sum, r) => sum + r.reservedUsd, 0);
  if (reserved + cfg.maxChargeUsd > cfg.dailyBudgetUsd + 1e-9) {
    // Wait until enough of the oldest reservations expire to fit one more run.
    let freed = 0;
    const needed = reserved + cfg.maxChargeUsd - cfg.dailyBudgetUsd;
    const release = s.starts.find((r) => (freed += r.reservedUsd) >= needed - 1e-9) ?? s.starts[0];
    throw busy(`24h worst-case spend $${reserved.toFixed(2)} of $${cfg.dailyBudgetUsd.toFixed(2)}`, (release.at + DAY_MS - now) / 1000);
  }

  s.starts.push({ at: now, reservedUsd: cfg.maxChargeUsd });
}

/**
 * Cost protection for paid Actor runs, per server instance:
 * - an identical search within `cacheTtlSecs` reuses the last result (empty included);
 * - an identical search already running shares that run;
 * - otherwise a new run starts only within the concurrency, hourly-run, and
 *   24 h worst-case-spend limits. Each started run books its full
 *   `maxChargeUsd`, whatever it ends up costing, so the budget can't be exceeded.
 * Failed runs are not cached, but still count against the limits.
 */
export async function guardedRun(cfg: LiveApifyConfig, key: string, run: () => Promise<CarListing[]>): Promise<CarListing[]> {
  const s = state();
  const now = Date.now();

  const cached = s.cache.get(key);
  if (cached && cfg.cacheTtlSecs > 0 && now - cached.at < cfg.cacheTtlSecs * 1000) return structuredClone(cached.listings);

  const pending = s.inflight.get(key);
  if (pending) return structuredClone(await pending);

  reserveRun(cfg, now);
  s.active++;
  const promise = run();
  s.inflight.set(key, promise);
  try {
    const listings = await promise;
    if (cfg.cacheTtlSecs > 0) {
      s.cache.delete(key);
      s.cache.set(key, { at: Date.now(), listings });
      while (s.cache.size > MAX_CACHE_ENTRIES) s.cache.delete(s.cache.keys().next().value!);
    }
    return structuredClone(listings);
  } finally {
    s.active--;
    s.inflight.delete(key);
  }
}

export function __resetApifyGuardForTests(): void {
  store.__secondGearApifyGuard = undefined;
}
