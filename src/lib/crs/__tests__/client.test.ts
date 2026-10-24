import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VerifiedConsent } from "@/lib/consent";
import { __resetCrsAuthForTests } from "@/lib/crs/auth";
import { checkReportOutcome, orderCreditReport } from "@/lib/crs/client";
import { CrsError } from "@/lib/crs/errors";
import { expectNoLeaks, liveConfig, liveConfigWith, PII, SYNTH_PASSWORD, SYNTH_SSN, syntheticP05Report } from "./fixtures";
import { startMockCrs, type MockCrs, type ReportMode } from "./mock-crs-server";

let crs: MockCrs;
const CONSENT: VerifiedConsent = { version: "soft-pull-v1", issuedAt: Date.now(), ipAddress: "203.0.113.9", userAgent: "test-agent" };

beforeEach(() => __resetCrsAuthForTests());
afterEach(async () => {
  await crs?.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function rejection(promise: Promise<unknown>): Promise<CrsError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(CrsError);
    return err as CrsError;
  }
  throw new Error("expected a CrsError");
}

describe("orderCreditReport", () => {
  it("posts the persona's documented body, fields at the root, to the prequal config with a bearer token", async () => {
    crs = await startMockCrs();
    const report = await orderCreditReport(liveConfig(crs.baseUrl), CONSENT);
    expect(report.responseDetail?.creditPullType).toBe("Soft");
    const [request] = crs.reportRequests;
    expect(request.path).toBe("/experian/credit-report/standard/exp-prequal-vantage4");
    expect(request.authorization).toMatch(/^Bearer eyJ/);
    expect(request.body).toEqual({
      firstName: "RICKY",
      lastName: "DALTON",
      ssn: SYNTH_SSN,
      addresses: [{ addressLine1: "7031 SUNSET RIDGE RD", city: "ORLANDO", state: "FL", postalCode: "32819", borrowerResidencyType: "Current" }],
    });
    // Consent metadata stays server-side: extra fields could break the persona match and make the pull billable.
    expect("ipAddress" in request.body || "userAgent" in request.body).toBe(false);
  });

  it("refuses to run without verified consent, before any network call", async () => {
    crs = await startMockCrs();
    const err = await rejection(orderCreditReport(liveConfig(crs.baseUrl), undefined as unknown as VerifiedConsent));
    expect(err.kind).toBe("config");
    expect(crs.logins + crs.reports).toBe(0);
  });

  it.each<[ReportMode, string, number | undefined]>([
    ["E1005", "config", undefined],
    ["freeze", "frozen", undefined],
    ["nohit", "no_file", undefined],
    ["hard", "not_soft_pull", undefined],
    ["401", "auth", 401],
    ["429", "rate_limited", 429],
    ["500", "upstream", 500],
    ["html", "invalid_response", undefined],
  ])("report mode %s → %s, never retried", async (mode, kind, status) => {
    crs = await startMockCrs({ report: mode });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = await rejection(orderCreditReport(liveConfig(crs.baseUrl), CONSENT));
    expect(err.kind).toBe(kind);
    if (status) expect(err.status).toBe(status);
    expect(crs.reports, "one report request, no retry").toBe(1);
    expectNoLeaks(err.message + err.userMessage, [...PII, SYNTH_PASSWORD, crs.baseUrl, ...crs.issuedTokens]);
  });

  it("accepts the sandbox response that omits pull-type metadata for the exact documented Experian prequal config", async () => {
    crs = await startMockCrs({ report: "missing-pull-type" });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const report = await orderCreditReport(liveConfig(crs.baseUrl), CONSENT);
    expect(report.responseDetail?.creditPullType).toBeUndefined();
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith("[crs] creditPullType missing; accepted documented Experian prequalification config");
  });

  it.each([{ bureau: "transunion" as const }, { configName: "exp-standard-vantage4" }])(
    "rejects missing pull-type metadata for an unapproved $bureau$configName context",
    async (overrides) => {
      crs = await startMockCrs({ report: "missing-pull-type" });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
      const err = await rejection(orderCreditReport(liveConfigWith(crs.baseUrl, overrides), CONSENT));
      expect(err.kind).toBe("not_soft_pull");
    },
  );

  it("carries Retry-After on a 429 without retrying", async () => {
    crs = await startMockCrs({ report: "429" });
    const err = await rejection(orderCreditReport(liveConfig(crs.baseUrl), CONSENT));
    expect(err.retryAfterSeconds).toBe(7);
    expect(crs.reports).toBe(1);
  });

  it("drops the cached token after a 401 so the next request logs in once more", async () => {
    crs = await startMockCrs({ report: "401" });
    const cfg = liveConfig(crs.baseUrl);
    await rejection(orderCreditReport(cfg, CONSENT));
    crs.options.report = "ok";
    await orderCreditReport(cfg, CONSENT);
    expect(crs.logins).toBe(2);
  });

  it("maps a timeout to `timeout` and a network failure to `upstream`, without retrying", async () => {
    crs = await startMockCrs();
    const cfg = liveConfig(crs.baseUrl);
    await orderCreditReport(cfg, CONSENT); // warm the token
    const realFetch = globalThis.fetch;
    const timeout = vi.fn(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    vi.stubGlobal("fetch", timeout);
    expect((await rejection(orderCreditReport(cfg, CONSENT))).kind).toBe("timeout");
    expect(timeout).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError(`fetch failed for ${crs.baseUrl}`);
    }));
    const network = await rejection(orderCreditReport(cfg, CONSENT));
    expect(network.kind).toBe("upstream");
    expectNoLeaks(network.message, [crs.baseUrl]);
    vi.stubGlobal("fetch", realFetch);
  });
});

describe("checkReportOutcome", () => {
  it("accepts a soft-pull file and rejects anything that is not explicitly Soft", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(checkReportOutcome(syntheticP05Report()).responseDetail?.creditPullType).toBe("Soft");
    for (const creditPullType of ["Hard", undefined, "soft"]) {
      const report = syntheticP05Report();
      report.responseDetail = { ...report.responseDetail, creditPullType };
      expect(() => checkReportOutcome(report)).toThrowError(/soft pull/);
    }
  });

  it("checks errorMessages before the file status", () => {
    const report = syntheticP05Report();
    report.errorMessages = [{ creditErrorMessageCode: "E2001" }];
    report.creditFiles = [{ creditFileDetail: { creditFileResultStatusType: "NoFileReturnedCreditFreeze" } }];
    expect(() => checkReportOutcome(report)).toThrowError(expect.objectContaining({ kind: "bureau_error" }) as never);
  });

  it("does not apply the documented-config fallback without matching context", () => {
    const report = syntheticP05Report();
    report.responseDetail = { dateRequested: "2026-10-24" };
    expect(() => checkReportOutcome(report)).toThrowError(expect.objectContaining({ kind: "not_soft_pull" }) as never);
  });

  it("treats a report with no creditFiles status as invalid", () => {
    const report = syntheticP05Report();
    report.creditFiles = [];
    expect(() => checkReportOutcome(report)).toThrowError(expect.objectContaining({ kind: "invalid_response" }) as never);
  });
});
