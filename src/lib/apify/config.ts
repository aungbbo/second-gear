import { ApifyError } from "@/lib/apify/errors";

export const DEFAULT_APIFY_BASE_URL = "https://api.apify.com/v2";
/** The mapper is written against this Actor's declared dataset schema. */
export const DEFAULT_LISTINGS_ACTOR_ID = "caffein.dev/autotrader-com-actor";
/** Values the Actor's `searchRadius` input accepts (0 means nationwide, which we never want). */
export const SEARCH_RADIUS_OPTIONS = ["10", "25", "50", "75", "100", "200", "300", "400", "500"] as const;
export type SearchRadius = (typeof SEARCH_RADIUS_OPTIONS)[number];

/** Apify's synchronous run endpoint gives up after 300 s. */
const MAX_SYNC_TIMEOUT_SECS = 300;
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
}

export type ApifyConfig = { mode: "mock" } | LiveApifyConfig;

const configError = (detail: string) => new ApifyError("config", `Listings provider not configured: ${detail}.`);

function intSetting(env: Record<string, string | undefined>, name: string, fallback: number, max: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) throw configError(`${name} must be an integer from 1 to ${max}`);
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

  const chargeRaw = env.APIFY_MAX_CHARGE_USD?.trim();
  const maxChargeUsd = chargeRaw ? Number(chargeRaw) : 0.25;
  if (!Number.isFinite(maxChargeUsd) || maxChargeUsd <= 0 || maxChargeUsd > MAX_CHARGE_CEILING_USD) {
    throw configError(`APIFY_MAX_CHARGE_USD must be a number above 0 and at most ${MAX_CHARGE_CEILING_USD}`);
  }

  return {
    mode: "live",
    token,
    actorId,
    baseUrl: (env.APIFY_BASE_URL?.trim() || DEFAULT_APIFY_BASE_URL).replace(/\/+$/, ""),
    searchRadius: radius as SearchRadius,
    maxItems: intSetting(env, "APIFY_MAX_ITEMS", 25, MAX_ITEMS_CEILING),
    maxChargeUsd,
    timeoutSecs: intSetting(env, "APIFY_RUN_TIMEOUT_SECS", 120, MAX_SYNC_TIMEOUT_SECS),
  };
}
