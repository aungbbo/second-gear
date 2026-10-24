import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeApify, type FakeApifyOptions } from "@/lib/apify/__tests__/fake-apify";
import { AFFORDABILITY, autotraderItem, CREDIT, NEED, TEST_TOKEN } from "@/lib/apify/__tests__/fixtures";
import { __resetApifyGuardForTests } from "@/lib/apify/guard";

// Credit, cash flow and ranking are other integrations; stub them so these tests cover listings only.
vi.mock("@/lib/providers/crs", () => ({ pullSoftCredit: vi.fn(async () => CREDIT) }));
vi.mock("@/lib/providers/nessie", () => ({ analyzeCashFlow: vi.fn(async () => AFFORDABILITY) }));

const { POST } = await import("./route");

const request = (need = NEED) =>
  new NextRequest("http://localhost/api/pipeline", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ need }),
  });

function goLive(options: FakeApifyOptions) {
  vi.stubEnv("APIFY_MODE", "live");
  vi.stubEnv("APIFY_API_TOKEN", TEST_TOKEN);
  vi.stubEnv("APIFY_BASE_URL", "https://api.apify.test/v2");
  fakeApify(options);
}

beforeEach(() => {
  __resetApifyGuardForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/pipeline — listings", () => {
  it("runs end to end on mock listings", async () => {
    vi.stubEnv("APIFY_MODE", "mock");
    const res = await POST(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listings.length).toBeGreaterThan(0);
    expect(body.rankedCars.length).toBeGreaterThan(0);
  });

  it("runs end to end on live listings and carries the listing link to the ranked cars", async () => {
    goLive({ items: [autotraderItem()] });
    const res = await POST(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listings.map((l: { id: string }) => l.id)).toEqual(["at_700000001"]);
    expect(body.rankedCars[0].listing).toMatchObject({
      id: "at_700000001",
      listingUrl: "https://www.autotrader.com/cars-for-sale/vehicledetails.xhtml?listingId=700000001",
    });
  });

  it("answers 503 when APIFY_MODE is unset", async () => {
    vi.stubEnv("APIFY_MODE", undefined);
    const res = await POST(request());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/APIFY_MODE/);
  });

  it.each([
    [401, 502],
    [402, 503],
    [408, 504],
    [429, 503],
    [500, 502],
  ])("maps Apify HTTP %i to %i with a buyer-safe message", async (upstream, status) => {
    goLive({ startError: { status: upstream, type: "x", message: TEST_TOKEN } });
    const res = await POST(request());
    expect(res.status).toBe(status);
    const text = await res.text();
    expect(text).toMatch(/We couldn't load live car listings|took too long/);
    expect(text).not.toContain(TEST_TOKEN);
  });

  it("answers 504 when a timed-out run collected nothing", async () => {
    goLive({ statuses: ["TIMED-OUT"], items: [] });
    const res = await POST(request());
    expect(res.status).toBe(504);
    expect((await res.json()).error).toMatch(/took too long/);
  });

  it("answers 422 when no listing is usable, never with mock cars", async () => {
    goLive({ items: [] });
    const res = await POST(request());
    expect(res.status).toBe(422);
    expect((await res.json()).listings).toBeUndefined();
  });

  it("answers 429 with Retry-After once the cost guard refuses a run", async () => {
    goLive({ items: [autotraderItem()] });
    vi.stubEnv("APIFY_MAX_RUNS_PER_HOUR", "1");
    expect((await POST(request())).status).toBe(200);

    const res = await POST(request({ ...NEED, zip: "10001" }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await res.json()).error).toMatch(/busy/);
  });
});
