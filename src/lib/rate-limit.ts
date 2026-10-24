import { Ratelimit, type Duration } from "@upstash/ratelimit";
import { getUpstashRedis, ConsentConfigurationError, ConsentStorageError } from "@/lib/consent-store";
import { recordSecurityEvent } from "@/lib/monitoring";

export type RateLimitScope = "consent-ip" | "consent-session" | "consent-global" | "pipeline-ip" | "pipeline-session" | "pipeline-global";

const POLICIES: Record<RateLimitScope, { limit: number; window: Duration }> = {
  "consent-ip": { limit: 5, window: "15 m" },
  "consent-session": { limit: 3, window: "15 m" },
  "consent-global": { limit: 100, window: "1 h" },
  "pipeline-ip": { limit: 5, window: "15 m" },
  "pipeline-session": { limit: 3, window: "15 m" },
  "pipeline-global": { limit: 100, window: "1 h" },
};

const localState = globalThis as typeof globalThis & {
  __secondGearLocalRateLimits?: Map<string, { count: number; reset: number }>;
};

export class RateLimitError extends Error {
  readonly userMessage = "Too many requests. Try again later.";
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds = 60) {
    super("Rate limit exceeded.");
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function windowToMs(window: Duration): number {
  const [amount, unit] = window.split(" ");
  const n = Number(amount);
  return unit === "h" ? n * 60 * 60 * 1000 : n * 60 * 1000;
}

export async function enforceRateLimits(scope: RateLimitScope, identifiers: string[]): Promise<void> {
  if (process.env.RATE_LIMIT_MODE === "memory") {
    if (process.env.NODE_ENV === "production") throw new ConsentConfigurationError("RATE_LIMIT_MODE=memory is not allowed in production");
    const state = (localState.__secondGearLocalRateLimits ??= new Map());
    const policy = POLICIES[scope];
    const now = Date.now();
    for (const identifier of identifiers) {
      const key = `${scope}:${identifier}`;
      const current = state.get(key);
      const entry = !current || current.reset <= now ? { count: 0, reset: now + windowToMs(policy.window) } : current;
      entry.count++;
      state.set(key, entry);
      if (entry.count > policy.limit) {
        recordSecurityEvent("rate_limit_blocked", "blocked");
        throw new RateLimitError(Math.max(1, Math.ceil((entry.reset - now) / 1000)));
      }
    }
    return;
  }
  try {
    const policy = POLICIES[scope];
    const limiter = new Ratelimit({ redis: getUpstashRedis(), limiter: Ratelimit.slidingWindow(policy.limit, policy.window), prefix: `second-gear:${scope}` });
    for (const identifier of identifiers) {
      const result = await limiter.limit(identifier);
      if (!result.success) {
        recordSecurityEvent("rate_limit_blocked", "blocked");
        throw new RateLimitError(Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)));
      }
    }
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    if (err instanceof ConsentConfigurationError || err instanceof ConsentStorageError) throw err;
    throw new ConsentStorageError(err);
  }
}

export function policyWindowMs(scope: RateLimitScope): number {
  return windowToMs(POLICIES[scope].window);
}

export function __resetRateLimitsForTests(): void {
  localState.__secondGearLocalRateLimits?.clear();
}
