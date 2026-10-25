import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeApify, type FakeApifyOptions } from "@/lib/apify/__tests__/fake-apify";
import { CARS_COM_RUN_ITEMS } from "@/lib/apify/__tests__/carscom-run";
import { AFFORDABILITY, carsComItem, CREDIT, ROOMY_AFFORDABILITY, ROOMY_NEED, TEST_TOKEN } from "@/lib/apify/__tests__/fixtures";
import { __resetApifyGuardForTests } from "@/lib/apify/guard";
import { issueConsentToken, SOFT_PULL_CONSENT_VERSION } from "@/lib/consent";
import { __resetRateLimitsForTests } from "@/lib/rate-limit";

// Credit, cash flow and ranking are other integrations; stub them so these tests cover listings only.
vi.mock("@/lib/providers/crs", () => ({ pullSoftCredit: vi.fn(async () => CREDIT) }));
vi.mock("@/lib/providers/nessie", () => ({ analyzeCashFlow: vi.fn(async () => ROOMY_AFFORDABILITY) }));

const { POST } = await import("@/app/api/pipeline/route");

// The route now requires a fresh, server-issued consent token on every request
// (see src/lib/consent.ts), added after these tests were first written.
function request(need = ROOMY_NEED) {
  const { consentToken } = issueConsentToken({ softPullAuthorized: true, textVersion: SOFT_PULL_CONSENT_VERSION });
  return new NextRequest("http://localhost/api/pipeline", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}` },
    body: JSON.stringify({ need, consentToken }),
  });
}

function goLive(options: FakeApifyOptions) {
  vi.stubEnv("APIFY_MODE", "live");
  vi.stubEnv("APIFY_API_TOKEN", TEST_TOKEN);
  vi.stubEnv("APIFY_BASE_URL", "https://api.apify.test/v2");
  return fakeApify(options);
}

beforeEach(() => {
  vi.stubEnv("CONSENT_STORE", "memory");
  vi.stubEnv("RATE_LIMIT_MODE", "memory");
  __resetApifyGuardForTests();
  __resetRateLimitsForTests();
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
    goLive({ items: [carsComItem()] });
    const res = await POST(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listings.map((l: { id: string }) => l.id)).toEqual(["cc_e3cfc9e8-11d9-4d4c-9272-fa995a6d3ef4"]);
    expect(body.rankedCars[0].listing).toMatchObject({
      id: "cc_e3cfc9e8-11d9-4d4c-9272-fa995a6d3ef4",
      listingUrl: "https://www.cars.com/vehicledetail/e3cfc9e8-11d9-4d4c-9272-fa995a6d3ef4/",
    });
  });

  it("runs end to end on the real 5-item Cars.com dataset, searching at the assessment's price ceiling", async () => {
    const { calls } = goLive({ items: CARS_COM_RUN_ITEMS });
    const res = await POST(request({ ...ROOMY_NEED, description: "A used Toyota Corolla sedan, 2017 or newer, under 100,000 miles." }));
    expect(res.status).toBe(200);
    const body = await res.json();

    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent).toMatchObject({ make: "Toyota", model: "Corolla", yearMin: 2017, mileageMax: 100000, zip: "95823", searchRadius: 50, condition: "USED" });
    expect(sent.priceMax).toBe(body.searchConstraints.maxPrice);
    expect(sent.priceMax).toBe(18700);

    expect(body.listings).toHaveLength(5);
    expect(body.rankedCars.length).toBeGreaterThan(0);
    for (const car of body.rankedCars) {
      expect(car.listing.listingUrl).toMatch(/^https:\/\/www\.cars\.com\/vehicledetail\//);
      expect(car.listing.price).toBeLessThanOrEqual(sent.priceMax);
    }
  });

  it("answers 422 without any paid run when the assessment leaves no room above $3,000", async () => {
    const { analyzeCashFlow } = await import("@/lib/providers/nessie");
    vi.mocked(analyzeCashFlow).mockResolvedValueOnce(AFFORDABILITY);
    const { calls } = goLive({ items: CARS_COM_RUN_ITEMS });
    const res = await POST(request());
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/doesn't leave room for a car priced above \$3,000/);
    expect(calls).toHaveLength(0);
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

  it("answers 503 with an inconclusive message when the run returned nothing, never with mock cars", async () => {
    goLive({ items: [] });
    const res = await POST(request());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.listings).toBeUndefined();
    expect(body.error).toMatch(/can't tell yet whether matching cars are for sale/);
  });

  it("answers 422 when no listing is usable, never with mock cars", async () => {
    goLive({ items: [carsComItem({ priceUsd: null })] });
    const res = await POST(request());
    expect(res.status).toBe(422);
    expect((await res.json()).listings).toBeUndefined();
  });

  it("answers 422 asking for a make, before the credit pull or any paid run, when none is named", async () => {
    goLive({ items: [carsComItem()] });
    const { pullSoftCredit } = await import("@/lib/providers/crs");
    vi.mocked(pullSoftCredit).mockClear();
    const res = await POST(request({ ...ROOMY_NEED, description: "A reliable car to commute, nothing fancy." }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/Tell us which make/);
    expect(pullSoftCredit).not.toHaveBeenCalled();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("still runs on mock listings when no make is named", async () => {
    vi.stubEnv("APIFY_MODE", "mock");
    const res = await POST(request({ ...ROOMY_NEED, description: "A reliable car to commute, nothing fancy." }));
    expect(res.status).toBe(200);
  });

  it("answers 429 with Retry-After once the cost guard refuses a run", async () => {
    goLive({ items: [carsComItem()] });
    vi.stubEnv("APIFY_MAX_RUNS_PER_HOUR", "1");
    expect((await POST(request())).status).toBe(200);

    const res = await POST(request({ ...ROOMY_NEED, zip: "10001" }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await res.json()).error).toMatch(/busy/);
  });
});
