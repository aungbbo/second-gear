import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import type { Redis } from "@upstash/redis";
import { ConsentConfigurationError, ConsentStorageError, getUpstashRedis } from "@/lib/consent-store";
import { recordSecurityEvent } from "@/lib/monitoring";
import { CrsError, CRS_UNAVAILABLE } from "@/lib/crs/errors";
import type { VerifiedConsent } from "@/lib/consent";

const localQuotaState = globalThis as typeof globalThis & { __secondGearLocalCrsQuota?: { count: number; reset: number } };

export class LiveCrsAccessError extends Error {
  readonly userMessage = "Live credit access is restricted.";
  readonly status = 403;

  constructor() {
    super("Live CRS access authorization was not provided.");
    this.name = "LiveCrsAccessError";
  }
}

function configuredAccessMatches(provided: string | null, configured: string): boolean {
  const expected = Buffer.from(configured);
  const actual = Buffer.from(provided ?? "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function assertLiveCrsRequest(req: NextRequest): void {
  if (process.env.CRS_MODE?.trim().toLowerCase() !== "live") return;
  if (process.env.CRS_LIVE_PULLS_ENABLED !== "true") {
    throw new CrsError("config", "Live credit access is disabled.", { detail: "CRS_LIVE_PULLS_ENABLED is not true" });
  }
  const configured = process.env.CRS_LIVE_ACCESS_TOKEN;
  if (!configured || Buffer.byteLength(configured) < 32) {
    throw new CrsError("config", CRS_UNAVAILABLE, { detail: "missing CRS_LIVE_ACCESS_TOKEN" });
  }
  if (!configuredAccessMatches(req.headers.get("x-crs-live-access-token"), configured)) throw new LiveCrsAccessError();
}

function quotaConfig(): { limit: number; window: `${number} s` } {
  const limit = Number(process.env.CRS_GLOBAL_PULL_LIMIT ?? "5");
  const seconds = Number(process.env.CRS_GLOBAL_PULL_WINDOW_SECONDS ?? "86400");
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(seconds) || seconds < 1) {
    throw new CrsError("config", CRS_UNAVAILABLE, { detail: "invalid global CRS pull quota configuration" });
  }
  return { limit, window: `${seconds} s` };
}

export async function reserveCrsPull(consent: VerifiedConsent, redisOverride?: Pick<Redis, "get">): Promise<void> {
  if (process.env.CRS_MODE?.trim().toLowerCase() !== "live") return;
  if (consent.liveAccessAuthorized !== true) throw new LiveCrsAccessError();
  if (process.env.CRS_QUOTA_MODE === "memory" && !redisOverride) {
    if (process.env.NODE_ENV === "production") throw new CrsError("config", CRS_UNAVAILABLE, { detail: "CRS_QUOTA_MODE=memory is not allowed in production" });
    const limit = Number(process.env.CRS_GLOBAL_PULL_LIMIT ?? "5");
    const seconds = Number(process.env.CRS_GLOBAL_PULL_WINDOW_SECONDS ?? "86400");
    const now = Date.now();
    const quota = localQuotaState.__secondGearLocalCrsQuota;
    if (!quota || quota.reset <= now) localQuotaState.__secondGearLocalCrsQuota = { count: 1, reset: now + seconds * 1000 };
    else if (++quota.count > limit) throw new CrsError("quota", "Live credit access is temporarily limited.", { status: 429 });
    recordSecurityEvent("crs_pull_attempt");
    return;
  }
  const key = process.env.CRS_KILL_SWITCH_KEY?.trim() || "second-gear:controls:crs-live-pulls";
  try {
    const controlRedis = redisOverride ?? getUpstashRedis();
    if ((await controlRedis.get<string>(key))?.trim().toLowerCase() === "disabled") {
      recordSecurityEvent("crs_kill_switch_blocked", "blocked");
      throw new CrsError("config", "Live credit access is temporarily disabled.");
    }
    const redis = getUpstashRedis();
    const { limit, window } = quotaConfig();
    const limiter = new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(limit, window), prefix: "second-gear:crs-global-quota" });
    const result = await limiter.limit("global");
    if (!result.success) {
      recordSecurityEvent("crs_quota_blocked", "blocked");
      throw new CrsError("quota", "Live credit access is temporarily limited.", { status: 429, retryAfterSeconds: Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)) });
    }
    recordSecurityEvent("crs_pull_attempt");
  } catch (err) {
    if (err instanceof CrsError) throw err;
    if (err instanceof ConsentConfigurationError || err instanceof ConsentStorageError) throw err;
    throw new ConsentStorageError(err);
  }
}

export function __resetCrsQuotaForTests(): void {
  localQuotaState.__secondGearLocalCrsQuota = undefined;
}
