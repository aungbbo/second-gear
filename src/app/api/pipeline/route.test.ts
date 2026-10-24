import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/pipeline/route";
import { issueConsentToken, SOFT_PULL_CONSENT_VERSION } from "@/lib/consent";
import { analyzeSnapshot } from "@/lib/nessie/cashflow";
import {
  API_KEY,
  BASE_URL,
  CUSTOMER_ID,
  NEED,
  NOW,
  SENSITIVE,
  baselineRoutes,
  baselineSnapshot,
  expectNoLeaks,
  stubNessieFetch,
} from "@/lib/nessie/__tests__/fixtures";
import type { PipelineResult } from "@/lib/types";
import { __resetRateLimitsForTests } from "@/lib/rate-limit";

// The other providers still simulate a few seconds of latency each.
vi.setConfig({ testTimeout: 20000 });

function stubLiveEnv() {
  vi.stubEnv("NESSIE_MODE", "live");
  vi.stubEnv("NESSIE_API_KEY", API_KEY);
  vi.stubEnv("NESSIE_CUSTOMER_ID", CUSTOMER_ID);
  vi.stubEnv("NESSIE_BASE_URL", BASE_URL);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The credit and listings steps now need an explicit mode; these Nessie-focused
// tests use the CRS and Apify mocks so only cash-flow behavior varies.
beforeEach(() => {
  vi.stubEnv("CONSENT_STORE", "memory");
  vi.stubEnv("RATE_LIMIT_MODE", "memory");
  vi.stubEnv("CRS_MODE", "mock");
  vi.stubEnv("APIFY_MODE", "mock");
  __resetRateLimitsForTests();
});

function pipelineRequest() {
  const { consentToken } = issueConsentToken({ softPullAuthorized: true, textVersion: SOFT_PULL_CONSENT_VERSION });
  return new NextRequest("http://localhost/api/pipeline", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${Math.floor(Math.random() * 200) + 1}` },
    body: JSON.stringify({ need: NEED, consentToken }),
  });
}

const PIPELINE_KEYS: (keyof PipelineResult)[] = [
  "need",
  "credit",
  "affordability",
  "affordabilityAssessment",
  "searchConstraints",
  "listings",
  "rankedCars",
  "dealerPacket",
  "savingsHighlight",
];

describe("POST /api/pipeline", () => {
  it("runs end to end in mock mode", async () => {
    vi.stubEnv("NESSIE_MODE", "mock");
    const response = await POST(pipelineRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as PipelineResult;
    expect(Object.keys(body).sort()).toEqual([...PIPELINE_KEYS].sort());
    expect(body.rankedCars.length).toBeGreaterThan(0);
  });

  it("returns 503 with a clear message when live credentials are missing", async () => {
    vi.stubEnv("NESSIE_MODE", "live");
    vi.stubEnv("NESSIE_API_KEY", "");
    vi.stubEnv("NESSIE_CUSTOMER_ID", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(pipelineRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Cash-flow provider not configured: missing NESSIE_API_KEY and NESSIE_CUSTOMER_ID.",
    });
  });

  it("returns 503 before providers when consent replay storage is unavailable", async () => {
    const request = pipelineRequest();
    vi.stubEnv("CONSENT_STORE", "upstash");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const response = await POST(request);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Consent service is not configured." });
  });

  it("returns 502 and hides the key when Nessie rejects the credentials", async () => {
    vi.stubEnv("NESSIE_MODE", "live");
    vi.stubEnv("NESSIE_API_KEY", API_KEY);
    vi.stubEnv("NESSIE_CUSTOMER_ID", CUSTOMER_ID);
    vi.stubEnv("NESSIE_BASE_URL", BASE_URL);
    stubNessieFetch({ [`/customers/${CUSTOMER_ID}/accounts`]: { status: 401 } });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(pipelineRequest());
    expect(response.status).toBe(502);
    expectNoLeaks(JSON.stringify(await response.json()), [API_KEY]);
    expectNoLeaks(JSON.stringify(errorLog.mock.calls), [API_KEY]);
  });

  it("returns 422 when the customer can't be verified", async () => {
    stubLiveEnv();
    stubNessieFetch({ [`/customers/${CUSTOMER_ID}/accounts`]: [] });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(pipelineRequest());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "We couldn't find that bank customer." });
    expectNoLeaks(JSON.stringify(errorLog.mock.calls), SENSITIVE);
  });

  it("returns 422 when a verified customer has no accounts", async () => {
    stubLiveEnv();
    stubNessieFetch({
      [`/customers/${CUSTOMER_ID}/accounts`]: [],
      [`/customers/${CUSTOMER_ID}`]: { _id: CUSTOMER_ID },
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(pipelineRequest());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "No accounts for this Nessie customer." });
    expectNoLeaks(JSON.stringify(errorLog.mock.calls), SENSITIVE);
  });

  it("never logs ids, host, or key on upstream errors", async () => {
    stubLiveEnv();
    stubNessieFetch({ ...baselineRoutes(), "/accounts/chk/deposits": { status: 401 } });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(pipelineRequest());
    expect(response.status).toBe(502);
    expect(errorLog).toHaveBeenCalled();
    expectNoLeaks(JSON.stringify(errorLog.mock.calls), SENSITIVE);
  });

  it("feeds live Nessie affordability into the rest of the pipeline", async () => {
    vi.stubEnv("NESSIE_MODE", "live");
    vi.stubEnv("NESSIE_API_KEY", API_KEY);
    vi.stubEnv("NESSIE_CUSTOMER_ID", CUSTOMER_ID);
    vi.stubEnv("NESSIE_BASE_URL", BASE_URL);
    stubNessieFetch(baselineRoutes());
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);

    const response = await POST(pipelineRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as PipelineResult;
    expect(body.affordability).toEqual(analyzeSnapshot(baselineSnapshot(), body.need, NOW));
    expect(body.dealerPacket.maxApprovedPayment).toBe(body.affordability.recommendedPayment);
  });
});
