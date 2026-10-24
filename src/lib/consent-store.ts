import { Redis } from "@upstash/redis";

export const CONSENT_STORE_KEY_PREFIX = "second-gear:consent:";

export interface ConsentReplayStore {
  claim(jti: string, ttlSeconds: number): Promise<boolean>;
}

export class ConsentStorageError extends Error {
  readonly userMessage = "Consent storage is temporarily unavailable.";

  constructor(cause?: unknown) {
    super("Consent replay storage request failed.");
    this.name = "ConsentStorageError";
    if (cause !== undefined) this.cause = cause;
  }
}

export class ConsentConfigurationError extends Error {
  readonly userMessage = "Consent service is not configured.";

  constructor(detail: string) {
    super(`Consent service configuration is invalid: ${detail}`);
    this.name = "ConsentConfigurationError";
  }
}

const redisState = globalThis as typeof globalThis & {
  __secondGearUpstash?: { url: string; token: string; client: Redis };
};

export function getUpstashRedis(env: Record<string, string | undefined> = process.env): Redis {
  const mode = env.CONSENT_STORE?.trim().toLowerCase();
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (mode !== "upstash" && (url || token)) {
    throw new ConsentConfigurationError("set CONSENT_STORE=upstash when using Upstash Redis");
  }
  if (!url || !token) {
    throw new ConsentConfigurationError("CONSENT_STORE=upstash requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN");
  }
  if (redisState.__secondGearUpstash?.url === url && redisState.__secondGearUpstash.token === token) {
    return redisState.__secondGearUpstash.client;
  }
  const client = new Redis({ url, token });
  redisState.__secondGearUpstash = { url, token, client };
  return client;
}

/** Local-only store for development and tests. Production rejects this mode. */
export class InMemoryConsentReplayStore implements ConsentReplayStore {
  private readonly entries = new Map<string, number>();

  async claim(jti: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    for (const [key, expiresAt] of this.entries) if (expiresAt <= now) this.entries.delete(key);
    if (this.entries.has(jti)) return false;
    this.entries.set(jti, now + ttlSeconds * 1000);
    return true;
  }

  getExpiry(jti: string): number | undefined {
    return this.entries.get(jti);
  }
}

const localStoreState = globalThis as typeof globalThis & {
  __secondGearConsentReplayStore?: InMemoryConsentReplayStore;
};

class UpstashConsentReplayStore implements ConsentReplayStore {
  constructor(private readonly redis: Redis) {}

  async claim(jti: string, ttlSeconds: number): Promise<boolean> {
    try {
      const result = await this.redis.set(`${CONSENT_STORE_KEY_PREFIX}${jti}`, "1", { nx: true, ex: ttlSeconds });
      return result === "OK";
    } catch (err) {
      throw new ConsentStorageError(err);
    }
  }
}

export function createConsentReplayStore(env: Record<string, string | undefined> = process.env): ConsentReplayStore {
  const mode = env.CONSENT_STORE?.trim().toLowerCase();
  if (mode === "memory") {
    if (env.NODE_ENV === "production") throw new ConsentConfigurationError("CONSENT_STORE=memory is not allowed in production");
    if (!localStoreState.__secondGearConsentReplayStore) {
      localStoreState.__secondGearConsentReplayStore = new InMemoryConsentReplayStore();
    }
    return localStoreState.__secondGearConsentReplayStore;
  }

  return new UpstashConsentReplayStore(getUpstashRedis(env));
}
