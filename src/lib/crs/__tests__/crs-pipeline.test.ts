import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/crs/mock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crs/mock")>();
  return { mockSoftCredit: vi.fn(actual.mockSoftCredit) };
});

import { POST as consentPOST } from "@/app/api/consent/route";
import { POST } from "@/app/api/pipeline/route";
import { issueConsentToken, SOFT_PULL_CONSENT_VERSION } from "@/lib/consent";
import { __resetCrsAuthForTests } from "@/lib/crs/auth";
import { mockSoftCredit } from "@/lib/crs/mock";
import { analyzeSnapshot } from "@/lib/nessie/cashflow";
import {
  API_KEY as NESSIE_KEY,
  BASE_URL as NESSIE_BASE_URL,
  CUSTOMER_ID as NESSIE_CUSTOMER,
  NEED,
  NOW,
  baselineRoutes,
  baselineSnapshot,
  stubNessieFetch,
} from "@/lib/nessie/__tests__/fixtures";
import type { PipelineResult } from "@/lib/types";
import { expectNoLeaks, PII, SYNTH_PASSWORD, SYNTH_SSN, SYNTH_USERNAME } from "./fixtures";
import { startMockCrs, type MockCrs, type ReportMode } from "./mock-crs-server";
import { __resetCrsQuotaForTests } from "@/lib/crs/guard";
import { __resetRateLimitsForTests } from "@/lib/rate-limit";

vi.setConfig({ testTimeout: 30000 });

let crs: MockCrs;

beforeEach(() => {
  vi.stubEnv("CONSENT_STORE", "memory");
  vi.stubEnv("RATE_LIMIT_MODE", "memory");
  vi.stubEnv("CRS_QUOTA_MODE", "memory");
  // Listings aren't the focus of this file; mock them so every test that
  // reaches step 3 doesn't need its own APIFY_MODE stub.
  vi.stubEnv("APIFY_MODE", "mock");
  __resetCrsQuotaForTests();
  __resetRateLimitsForTests();
  __resetCrsAuthForTests();
  vi.mocked(mockSoftCredit).mockClear();
});
afterEach(async () => {
  await crs?.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function liveCrsEnv() {
  vi.stubEnv("CRS_MODE", "live");
  vi.stubEnv("CRS_LIVE_PULLS_ENABLED", "true");
  vi.stubEnv("APP_ORIGIN", "http://localhost");
  vi.stubEnv("CRS_USERNAME", SYNTH_USERNAME);
  vi.stubEnv("CRS_PASSWORD", SYNTH_PASSWORD);
  vi.stubEnv("CRS_TEST_PERSONA", "P05");
  vi.stubEnv("CRS_PERSONA_SSN", SYNTH_SSN);
  vi.stubEnv("CRS_BASE_URL", crs.baseUrl);
}

/** Live Nessie on stubbed fetch for its host; everything else (the CRS mock) goes to the network. */
function liveNessie() {
  vi.stubEnv("NESSIE_MODE", "live");
  vi.stubEnv("NESSIE_API_KEY", NESSIE_KEY);
  vi.stubEnv("NESSIE_CUSTOMER_ID", NESSIE_CUSTOMER);
  vi.stubEnv("NESSIE_BASE_URL", NESSIE_BASE_URL);
  const realFetch = globalThis.fetch;
  const nessie = stubNessieFetch(baselineRoutes());
  const router = vi.fn((input: string | URL | Request, init?: RequestInit) =>
    String(input).startsWith(NESSIE_BASE_URL) ? nessie(input) : realFetch(input, init),
  );
  vi.stubGlobal("fetch", router);
  return nessie;
}

const token = () => issueConsentToken({ softPullAuthorized: true, textVersion: SOFT_PULL_CONSENT_VERSION }).consentToken;

function request(body: object) {
  return new NextRequest("http://localhost/api/pipeline", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "vitest", origin: "http://localhost", "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    body: JSON.stringify(body),
  });
}

async function run(body: object) {
  const response = await POST(request(body));
  return { status: response.status, headers: response.headers, body: await response.json() };
}

describe("consent gate", () => {
  it.each([
    ["no token", {}],
    ["a forged token", { consentToken: "e30.AAAA" }],
  ])("refuses %s with 400 before any provider runs", async (_label, extra) => {
    crs = await startMockCrs();
    liveCrsEnv();
    const nessie = liveNessie();
    const res = await run({ need: NEED, ...extra });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Consent to a soft credit check is required." });
    expect(crs.logins + crs.reports).toBe(0);
    expect(nessie).not.toHaveBeenCalled();
  });

  it("refuses a replayed token", async () => {
    vi.stubEnv("CRS_MODE", "mock");
    vi.stubEnv("NESSIE_MODE", "mock");
    const consentToken = token();
    expect((await run({ need: NEED, consentToken })).status).toBe(200);
    expect((await run({ need: NEED, consentToken })).status).toBe(400);
  });

  it("/api/consent issues a token only for the current consent text", async () => {
    const post = (body: object) =>
      consentPOST(new NextRequest("http://localhost/api/consent", { method: "POST", body: JSON.stringify(body) }));
    const ok = await post({ softPullAuthorized: true, textVersion: SOFT_PULL_CONSENT_VERSION });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(typeof (await ok.json()).consentToken).toBe("string");
    expect((await post({ softPullAuthorized: true, textVersion: "old" })).status).toBe(400);
    expect((await post({ textVersion: SOFT_PULL_CONSENT_VERSION })).status).toBe(400);
  });
});

describe("live CRS + live Nessie through /api/pipeline", () => {
  it("returns 200 with the CRS score and unchanged Nessie affordability, and leaks nothing", async () => {
    crs = await startMockCrs();
    liveCrsEnv();
    liveNessie();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await run({ need: NEED, consentToken: token() });
    expect(res.status).toBe(200);
    const body = res.body as PipelineResult;
    expect(body.credit).toMatchObject({ score: 540, tier: "deep-subprime", estimatedApr: { min: 18, max: 24 }, hardInquiriesLast6mo: null });
    expect(body.affordability).toEqual(analyzeSnapshot(baselineSnapshot(), body.need, NOW));
    expect(body.rankedCars.length).toBeGreaterThan(0);
    expect(mockSoftCredit).not.toHaveBeenCalled();
    expect(crs.logins).toBe(1);
    expect(crs.reports).toBe(1);

    const everything = JSON.stringify(body) + JSON.stringify(errors.mock.calls);
    expectNoLeaks(everything, [...PII, SYNTH_PASSWORD, SYNTH_USERNAME, crs.baseUrl, ...crs.issuedTokens]);
  });

  it.each<[string, Parameters<typeof startMockCrs>[0], number, string]>([
    ["wrong config (E1005)", { report: "E1005" as ReportMode }, 503, "Credit provider not configured."],
    ["frozen file", { report: "freeze" }, 422, "Your credit file is frozen"],
    ["no file", { report: "nohit" }, 422, "No credit file was found."],
    ["no score", { report: "noscore" }, 422, "Your credit file couldn't be scored."],
    ["hard pull", { report: "hard" }, 502, "the credit check wasn't a soft pull"],
    ["expired token / no bureau role", { report: "401" }, 502, "We couldn't complete the credit check right now."],
    ["rate limited", { report: "429" }, 503, "The credit service is busy"],
    ["login refused", { loginFails: true }, 502, "We couldn't complete the credit check right now."],
  ])("%s → %i, no mock fallback, no leaks", async (_label, options, status, message) => {
    crs = await startMockCrs(options);
    liveCrsEnv();
    const nessie = liveNessie();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await run({ need: NEED, consentToken: token() });
    expect(res.status).toBe(status);
    expect(res.body.error).toContain(message);
    expect(mockSoftCredit).not.toHaveBeenCalled();
    expect(nessie, "later steps don't run after a credit failure").not.toHaveBeenCalled();
    if (options?.report === "429") expect(res.headers.get("retry-after")).toBe("7");
    expectNoLeaks(JSON.stringify(res.body) + JSON.stringify(errors.mock.calls), [...PII, SYNTH_PASSWORD, SYNTH_USERNAME, crs.baseUrl, ...crs.issuedTokens]);
  });

  it("returns 503 when CRS_MODE is unset or live settings are missing", async () => {
    vi.stubEnv("NESSIE_MODE", "mock");
    vi.stubEnv("CRS_MODE", "");
    expect((await run({ need: NEED, consentToken: token() })).status).toBe(503);
    vi.stubEnv("CRS_MODE", "live");
    vi.stubEnv("CRS_USERNAME", SYNTH_USERNAME);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await run({ need: NEED, consentToken: token() });
    expect(res.status).toBe(503);
    expect(mockSoftCredit).not.toHaveBeenCalled();
  });

  it("uses the mock only when CRS_MODE=mock", async () => {
    vi.stubEnv("CRS_MODE", "mock");
    vi.stubEnv("NESSIE_MODE", "mock");
    const res = await run({ need: NEED, consentToken: token() });
    expect(res.status).toBe(200);
    expect(mockSoftCredit).toHaveBeenCalledTimes(1);
  });
});
