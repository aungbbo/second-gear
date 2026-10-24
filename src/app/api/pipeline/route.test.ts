import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/pipeline/route";
import { analyzeSnapshot } from "@/lib/nessie/cashflow";
import {
  API_KEY,
  BASE_URL,
  CUSTOMER_ID,
  NEED,
  NOW,
  baselineRoutes,
  baselineSnapshot,
  stubNessieFetch,
} from "@/lib/nessie/__tests__/fixtures";
import type { PipelineResult } from "@/lib/types";

// The other providers still simulate a few seconds of latency each.
vi.setConfig({ testTimeout: 20000 });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function pipelineRequest() {
  return new NextRequest("http://localhost/api/pipeline", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ need: NEED }),
  });
}

const PIPELINE_KEYS: (keyof PipelineResult)[] = [
  "need",
  "credit",
  "affordability",
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

  it("returns 502 and hides the key when Nessie rejects the credentials", async () => {
    vi.stubEnv("NESSIE_MODE", "live");
    vi.stubEnv("NESSIE_API_KEY", API_KEY);
    vi.stubEnv("NESSIE_CUSTOMER_ID", CUSTOMER_ID);
    vi.stubEnv("NESSIE_BASE_URL", BASE_URL);
    stubNessieFetch({ [`/customers/${CUSTOMER_ID}/accounts`]: { status: 401 } });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(pipelineRequest());
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain(API_KEY);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(API_KEY);
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
