import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertLiveCrsRequest, reserveCrsPull, __resetCrsQuotaForTests } from "@/lib/crs/guard";
import { RateLimitError, enforceRateLimits, __resetRateLimitsForTests } from "@/lib/rate-limit";
import { assertRequestOrigin, OriginConfigurationError } from "@/lib/request-identity";
import { POST as consentPOST } from "@/app/api/consent/route";
import { POST as pipelinePOST } from "@/app/api/pipeline/route";
import { SOFT_PULL_CONSENT_VERSION } from "@/lib/consent";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("RATE_LIMIT_MODE", "memory");
  vi.stubEnv("CRS_QUOTA_MODE", "memory");
  vi.stubEnv("CONSENT_STORE", "memory");
  vi.stubEnv("CRS_MODE", "mock");
  vi.stubEnv("NESSIE_MODE", "mock");
  __resetRateLimitsForTests();
  __resetCrsQuotaForTests();
});

afterEach(() => vi.unstubAllEnvs());

describe("distributed-control contracts", () => {
  it("limits concurrent token farming in one bucket", async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => enforceRateLimits("consent-ip", ["test-ip"])));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
    expect(results.filter((result) => result.status === "rejected").every((result) => result.reason instanceof RateLimitError)).toBe(true);
  });

  it("maintains a separate global pipeline quota", async () => {
    const results = await Promise.allSettled(Array.from({ length: 101 }, () => enforceRateLimits("pipeline-global", ["global"])));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(100);
    expect(results.filter((result) => result.status === "rejected").every((result) => result.reason instanceof RateLimitError)).toBe(true);
  });

  it("keeps live CRS disabled unless explicitly enabled", () => {
    vi.stubEnv("CRS_MODE", "live");
    vi.stubEnv("CRS_LIVE_PULLS_ENABLED", "false");
    expect(() => assertLiveCrsRequest()).toThrow("Live credit access is disabled.");
  });

  it("enforces the global CRS quota before a later pull", async () => {
    vi.stubEnv("CRS_MODE", "live");
    vi.stubEnv("CRS_GLOBAL_PULL_LIMIT", "2");
    const consent = { version: "soft-pull-v1", issuedAt: Date.now(), liveAccessAuthorized: true };
    await reserveCrsPull(consent);
    await reserveCrsPull(consent);
    await expect(reserveCrsPull(consent)).rejects.toMatchObject({ kind: "quota" });
  });

  it("honors the Redis emergency kill switch before quota reservation", async () => {
    vi.stubEnv("CRS_MODE", "live");
    const redis = { get: vi.fn(async () => "disabled") };
    await expect(reserveCrsPull({ version: "soft-pull-v1", issuedAt: Date.now(), liveAccessAuthorized: true }, redis as never)).rejects.toMatchObject({ kind: "config" });
    expect(redis.get).toHaveBeenCalledTimes(1);
  });

  it("requires configured origin validation in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => assertRequestOrigin(new NextRequest("https://demo.test/api/consent", { headers: { origin: "https://demo.test" } }))).toThrow(OriginConfigurationError);
    vi.stubEnv("APP_ORIGIN", "https://demo.test");
    expect(() => assertRequestOrigin(new NextRequest("https://demo.test/api/consent", { headers: { origin: "https://evil.test" } }))).toThrow();
  });

  it("fails closed instead of falling back when production rate-limit Redis is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RATE_LIMIT_MODE", "");
    vi.stubEnv("CONSENT_STORE", "upstash");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    await expect(enforceRateLimits("pipeline-ip", ["unknown"])).rejects.toMatchObject({ name: "ConsentConfigurationError" });
  });

  it("rejects a valid consent token transferred to another session", async () => {
    const first = await consentPOST(new NextRequest("http://localhost/api/consent", { method: "POST", body: JSON.stringify({ softPullAuthorized: true, textVersion: SOFT_PULL_CONSENT_VERSION }) }));
    const second = await consentPOST(new NextRequest("http://localhost/api/consent", { method: "POST", body: JSON.stringify({ softPullAuthorized: true, textVersion: SOFT_PULL_CONSENT_VERSION }) }));
    const token = (await first.json()).consentToken as string;
    const cookie = second.headers.get("set-cookie")?.split(";")[0];
    const response = await pipelinePOST(new NextRequest("http://localhost/api/pipeline", {
      method: "POST",
      headers: { cookie: cookie ?? "", "content-type": "application/json" },
      body: JSON.stringify({ need: { description: "sedan", maxMonthlyPayment: 400 }, consentToken: token }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Consent to a soft credit check is required." });
  });
});
