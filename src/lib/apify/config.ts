import { ApifyError } from "@/lib/apify/errors";

export const DEFAULT_APIFY_BASE_URL = "https://api.apify.com/v2";
/** The mapper is written against this Actor's declared dataset schema. */
export const DEFAULT_LISTINGS_ACTOR_ID = "caffein.dev/autotrader-com-actor";
/**
 * Radii both the Actor's input schema and its README list. The schema also
 * accepts 75, 300 and 400, but the README omits them, so they are left out
 * until a run shows AutoTrader honours them. `0` (nationwide) is never used.
 */
export const SEARCH_RADIUS_OPTIONS = ["10", "25", "50", "100", "200", "500"] as const;
export type SearchRadius = (typeof SEARCH_RADIUS_OPTIONS)[number];

/**
 * Keeps the whole step (start, polling, abort, dataset read) inside the
 * pipeline route's 300 s `maxDuration`.
 */
const MAX_RUN_TIMEOUT_SECS = 240;
const MAX_ITEMS_CEILING = 100;
const MAX_CHARGE_CEILING_USD = 5;

export interface LiveApifyConfig {
  mode: "live";
  token: string;
  actorId: string;
  baseUrl: string;
  searchRadius: SearchRadius;
  maxItems: number;
  maxChargeUsd: number;
  timeoutSecs: number;
  /** Cost guard: started runs per rolling hour. */
  maxRunsPerHour: number;
  /** Cost guard: worst-case spend (maxChargeUsd per started run) per rolling 24 h. */
  dailyBudgetUsd: number;
  /** Cost guard: runs in flight at once. */
  maxConcurrentRuns: number;
  /** Identical searches within this window reuse the last result; 0 disables. */
  cacheTtlSecs: number;
}

export type ApifyConfig = { mode: "mock" } | LiveApifyConfig;

const configError = (detail: string) => new ApifyError("config", `Listings provider not configured: ${detail}.`);

function intSetting(env: Record<string, string | undefined>, name: string, fallback: number, max: number, min = 1): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw configError(`${name} must be an integer from ${min} to ${max}`);
  return n;
}

function usdSetting(env: Record<string, string | undefined>, name: string, fallback: number, max: number): number {
  const raw = env[name]?.trim();
  const n = raw ? Number(raw) : fallback;
  if (!Number.isFinite(n) || n <= 0 || n > max) throw configError(`${name} must be a number above 0 and at most ${max}`);
  return n;
}

/**
 * Reads the Apify settings from the environment on every call. The mode
 * must be chosen explicitly — there is no default, so a missing setting can
 * never quietly turn into mock listings.
 */
export function getApifyConfig(env: Record<string, string | undefined> = process.env): ApifyConfig {
  const mode = env.APIFY_MODE?.trim().toLowerCase();

  if (mode === "mock") return { mode: "mock" };
  if (mode !== "live") throw configError("set APIFY_MODE=live or APIFY_MODE=mock");

  const token = env.APIFY_API_TOKEN?.trim();
  if (!token) throw configError("missing APIFY_API_TOKEN");

  const actorId = env.APIFY_LISTINGS_ACTOR_ID?.trim() || DEFAULT_LISTINGS_ACTOR_ID;
  if (!/^[\w.-]+[/~][\w.-]+$/.test(actorId)) throw configError("APIFY_LISTINGS_ACTOR_ID must look like owner/actor-name");

  const radius = env.APIFY_SEARCH_RADIUS_MILES?.trim() || "50";
  if (!(SEARCH_RADIUS_OPTIONS as readonly string[]).includes(radius)) {
    throw configError(`APIFY_SEARCH_RADIUS_MILES must be one of ${SEARCH_RADIUS_OPTIONS.join(", ")}`);
  }

  const maxChargeUsd = usdSetting(env, "APIFY_MAX_CHARGE_USD", 0.25, MAX_CHARGE_CEILING_USD);
  const dailyBudgetUsd = usdSetting(env, "APIFY_DAILY_BUDGET_USD", 2, 100);
  if (dailyBudgetUsd < maxChargeUsd) throw configError("APIFY_DAILY_BUDGET_USD must be at least APIFY_MAX_CHARGE_USD");

  return {
    mode: "live",
    token,
    actorId,
    baseUrl: (env.APIFY_BASE_URL?.trim() || DEFAULT_APIFY_BASE_URL).replace(/\/+$/, ""),
    searchRadius: radius as SearchRadius,
    maxItems: intSetting(env, "APIFY_MAX_ITEMS", 25, MAX_ITEMS_CEILING),
    maxChargeUsd,
    timeoutSecs: intSetting(env, "APIFY_RUN_TIMEOUT_SECS", 120, MAX_RUN_TIMEOUT_SECS),
    maxRunsPerHour: intSetting(env, "APIFY_MAX_RUNS_PER_HOUR", 10, 1000),
    dailyBudgetUsd,
    maxConcurrentRuns: intSetting(env, "APIFY_MAX_CONCURRENT_RUNS", 2, 10),
    cacheTtlSecs: intSetting(env, "APIFY_CACHE_TTL_SECS", 900, 86_400, 0),
  };
}
