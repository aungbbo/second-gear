import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/nessie/mock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nessie/mock")>();
  return { mockCashFlow: vi.fn(actual.mockCashFlow) };
});

import { getNessieConfig } from "@/lib/nessie/config";
import { NessieError } from "@/lib/nessie/errors";
import { mockCashFlow } from "@/lib/nessie/mock";
import { analyzeCashFlow } from "@/lib/providers/nessie";
import type { CreditReport } from "@/lib/types";
import { API_KEY, BASE_URL, CUSTOMER_ID, NEED, baselineRoutes, stubNessieFetch } from "./fixtures";

const CREDIT = { score: 600 } as CreditReport;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(mockCashFlow).mockClear();
});

function stubLiveEnv() {
  vi.stubEnv("NESSIE_MODE", "live");
  vi.stubEnv("NESSIE_API_KEY", API_KEY);
  vi.stubEnv("NESSIE_CUSTOMER_ID", CUSTOMER_ID);
  vi.stubEnv("NESSIE_BASE_URL", BASE_URL);
}

describe("getNessieConfig", () => {
  it("requires an explicit mode", () => {
    expect(() => getNessieConfig({})).toThrowError(/NESSIE_MODE=live or NESSIE_MODE=mock/);
    expect(() => getNessieConfig({ NESSIE_MODE: "demo" })).toThrowError(NessieError);
  });

  it("accepts mock mode without credentials", () => {
    expect(getNessieConfig({ NESSIE_MODE: "Mock " })).toEqual({ mode: "mock" });
  });

  it("names every missing live credential", () => {
    expect(() => getNessieConfig({ NESSIE_MODE: "live" })).toThrowError(
      /missing NESSIE_API_KEY and NESSIE_CUSTOMER_ID/,
    );
    expect(() => getNessieConfig({ NESSIE_MODE: "live", NESSIE_API_KEY: "k" })).toThrowError(
      /missing NESSIE_CUSTOMER_ID\.$/,
    );
  });

  it("defaults the base URL and trims a trailing slash", () => {
    expect(getNessieConfig({ NESSIE_MODE: "live", NESSIE_API_KEY: "k", NESSIE_CUSTOMER_ID: "c" })).toMatchObject({
      baseUrl: "http://api.nessieisreal.com",
    });
    expect(
      getNessieConfig({ NESSIE_MODE: "live", NESSIE_API_KEY: "k", NESSIE_CUSTOMER_ID: "c", NESSIE_BASE_URL: "http://x.test/" }),
    ).toMatchObject({ baseUrl: "http://x.test" });
  });
});

describe("analyzeCashFlow dispatcher", () => {
  it("uses the deterministic mock when NESSIE_MODE=mock", async () => {
    vi.stubEnv("NESSIE_MODE", "mock");
    const first = await analyzeCashFlow(NEED, CREDIT);
    const second = await analyzeCashFlow(NEED, CREDIT);
    expect(second).toEqual(first);
    expect(mockCashFlow).toHaveBeenCalledTimes(2);
  });

  it("refuses to run when the mode is unset", async () => {
    vi.stubEnv("NESSIE_MODE", "");
    await expect(analyzeCashFlow(NEED, CREDIT)).rejects.toMatchObject({ kind: "config" });
    expect(mockCashFlow).not.toHaveBeenCalled();
  });

  it("refuses live mode without a key instead of falling back", async () => {
    stubLiveEnv();
    vi.stubEnv("NESSIE_API_KEY", "");
    await expect(analyzeCashFlow(NEED, CREDIT)).rejects.toMatchObject({ kind: "config" });
    expect(mockCashFlow).not.toHaveBeenCalled();
  });

  it("propagates a live upstream failure and never calls the mock", async () => {
    stubLiveEnv();
    stubNessieFetch({ [`/customers/${CUSTOMER_ID}/accounts`]: { status: 500 } });
    await expect(analyzeCashFlow(NEED, CREDIT)).rejects.toMatchObject({ kind: "upstream" });
    expect(mockCashFlow).not.toHaveBeenCalled();
  });

  it("returns live affordability from Nessie data", async () => {
    stubLiveEnv();
    stubNessieFetch(baselineRoutes());
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
    try {
      const result = await analyzeCashFlow(NEED, CREDIT);
      expect(result.avgMonthlyIncome).toBe(3000);
      expect(result.maxSustainablePayment).toBe(310);
      expect(mockCashFlow).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
