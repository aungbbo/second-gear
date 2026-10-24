import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSENT_MAX_AGE_MS,
  ConsentError,
  consumeConsentToken,
  issueConsentToken,
  SOFT_PULL_CONSENT_VERSION,
} from "@/lib/consent";
import {
  ConsentConfigurationError,
  ConsentStorageError,
  createConsentReplayStore,
  type ConsentReplayStore,
} from "@/lib/consent-store";

const APPROVAL = { softPullAuthorized: true, textVersion: SOFT_PULL_CONSENT_VERSION };

beforeEach(() => {
  vi.stubEnv("CONSENT_STORE", "memory");
  vi.stubEnv("NODE_ENV", "test");
});

async function rejectionKind(fn: () => unknown | Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ConsentError);
    return (err as ConsentError).kind;
  }
  throw new Error("expected a ConsentError");
}

describe("issueConsentToken", () => {
  it("issues a token only for an explicit approval of the current text", async () => {
    expect(issueConsentToken(APPROVAL).consentToken).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(await rejectionKind(() => issueConsentToken({}))).toBe("missing");
    expect(await rejectionKind(() => issueConsentToken({ softPullAuthorized: "true", textVersion: SOFT_PULL_CONSENT_VERSION }))).toBe("missing");
    expect(await rejectionKind(() => issueConsentToken({ softPullAuthorized: true, textVersion: "soft-pull-v0" }))).toBe("wrong_version");
  });

  it("stamps the server's clock and ignores any client-supplied time", async () => {
    const serverNow = Date.UTC(2026, 9, 24, 12);
    const { consentToken, expiresAt } = issueConsentToken({ ...APPROVAL, consentedAt: "2020-01-01T00:00:00Z", iat: 1 }, serverNow);
    expect(expiresAt).toBe(new Date(serverNow + CONSENT_MAX_AGE_MS).toISOString());
    expect((await consumeConsentToken(consentToken, {}, serverNow + 1000)).issuedAt).toBe(serverNow);
  });
});

describe("consumeConsentToken", () => {
  it("accepts a fresh token once and keeps request context server-side", async () => {
    const { consentToken } = issueConsentToken(APPROVAL);
    const consent = await consumeConsentToken(consentToken, { ipAddress: "203.0.113.9", userAgent: "x".repeat(400) });
    expect(consent.version).toBe(SOFT_PULL_CONSENT_VERSION);
    expect(consent.ipAddress).toBe("203.0.113.9");
    expect(consent.userAgent).toHaveLength(256);
    expect(await rejectionKind(() => consumeConsentToken(consentToken))).toBe("replayed");
  });

  it("rejects missing, malformed, and tampered tokens", async () => {
    expect(await rejectionKind(() => consumeConsentToken(undefined))).toBe("missing");
    expect(await rejectionKind(() => consumeConsentToken(""))).toBe("missing");
    expect(await rejectionKind(() => consumeConsentToken("not-a-token"))).toBe("malformed");
    expect(await rejectionKind(() => consumeConsentToken("a.b.c"))).toBe("malformed");
    const { consentToken } = issueConsentToken(APPROVAL);
    const [payload, signature] = consentToken.split(".");
    const forged = Buffer.from(JSON.stringify({ v: SOFT_PULL_CONSENT_VERSION, iat: Date.now(), jti: "forged" })).toString("base64url");
    expect(await rejectionKind(() => consumeConsentToken(`${forged}.${signature}`))).toBe("bad_signature");
    expect(await rejectionKind(() => consumeConsentToken(`${payload}.${signature.slice(0, -2)}xx`))).toBe("bad_signature");
  });

  it("rejects expired tokens and tokens from the future by the server clock", async () => {
    const issuedAt = Date.UTC(2026, 9, 24, 12);
    const stale = issueConsentToken(APPROVAL, issuedAt).consentToken;
    expect(await rejectionKind(() => consumeConsentToken(stale, {}, issuedAt + CONSENT_MAX_AGE_MS + 1))).toBe("expired");
    const future = issueConsentToken(APPROVAL, issuedAt + 60_000).consentToken;
    expect(await rejectionKind(() => consumeConsentToken(future, {}, issuedAt))).toBe("future");
  });

  it("claims a token globally once across independent consumers and records remaining TTL", async () => {
    class SharedStore implements ConsentReplayStore {
      readonly claims: { jti: string; ttlSeconds: number }[] = [];
      private readonly claimed = new Set<string>();

      async claim(jti: string, ttlSeconds: number) {
        this.claims.push({ jti, ttlSeconds });
        if (this.claimed.has(jti)) return false;
        this.claimed.add(jti);
        return true;
      }
    }
    const shared = new SharedStore();
    const issuedAt = Date.UTC(2026, 9, 24, 12);
    const { consentToken } = issueConsentToken(APPROVAL, issuedAt);
    await consumeConsentToken(consentToken, {}, issuedAt + 1000, shared);
    expect(await rejectionKind(() => consumeConsentToken(consentToken, {}, issuedAt + 1000, shared))).toBe("replayed");
    expect(shared.claims[0]?.ttlSeconds).toBe(Math.ceil((CONSENT_MAX_AGE_MS - 1000) / 1000));
  });

  it("allows exactly one concurrent claim", async () => {
    class AtomicStore implements ConsentReplayStore {
      private claimed = false;

      async claim() {
        if (this.claimed) return false;
        this.claimed = true;
        await Promise.resolve();
        return true;
      }
    }
    const store = new AtomicStore();
    const { consentToken } = issueConsentToken(APPROVAL);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => consumeConsentToken(consentToken, {}, Date.now(), store)),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected").map((result) => (result as PromiseRejectedResult).reason.kind)).toEqual(
      Array(19).fill("replayed"),
    );
  });

  it("binds a consent token to its issuing session", async () => {
    const sessionA = "a".repeat(64);
    const sessionB = "b".repeat(64);
    const { consentToken } = issueConsentToken(APPROVAL, Date.now(), sessionA);
    expect(await rejectionKind(() => consumeConsentToken(consentToken, {}, Date.now(), undefined, sessionB))).toBe("session_mismatch");
    await expect(consumeConsentToken(consentToken, {}, Date.now(), undefined, sessionA)).resolves.toMatchObject({ version: SOFT_PULL_CONSENT_VERSION });
  });

  it("fails closed when shared storage fails", async () => {
    const { consentToken } = issueConsentToken(APPROVAL);
    const store: ConsentReplayStore = { claim: async () => { throw new ConsentStorageError(); } };
    await expect(consumeConsentToken(consentToken, {}, Date.now(), store)).rejects.toBeInstanceOf(ConsentStorageError);
  });

  it("fails closed when the Upstash Redis request fails", async () => {
    vi.stubEnv("CONSENT_STORE", "upstash");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.example.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("simulated Redis outage"); }));
    const store = createConsentReplayStore();
    await expect(store.claim("jti", 30)).rejects.toBeInstanceOf(ConsentStorageError);
  });

  it("rejects production without a secure secret or shared Upstash configuration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CONSENT_SIGNING_SECRET", "");
    expect(() => issueConsentToken(APPROVAL)).toThrow(ConsentConfigurationError);
    vi.stubEnv("CONSENT_SIGNING_SECRET", "x".repeat(32));
    expect(() => createConsentReplayStore()).toThrow(ConsentConfigurationError);
  });
});
