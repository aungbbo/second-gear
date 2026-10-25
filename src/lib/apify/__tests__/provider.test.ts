import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApifyError } from "@/lib/apify/errors";
import { __resetApifyGuardForTests } from "@/lib/apify/guard";
import { searchLiveListings } from "@/lib/providers/apify";
import { fakeApify, type FakeApifyOptions } from "./fake-apify";
import type { AffordableSearchConstraints } from "@/lib/types";
import { CARS_COM_RUN_ITEMS } from "./carscom-run";
import { AFFORDABILITY, carsComItem, CONSTRAINTS, CREDIT, NEED, PLAN, TEST_TOKEN } from "./fixtures";

const ENV_KEYS = ["APIFY_MODE", "APIFY_API_TOKEN", "APIFY_BASE_URL", "APIFY_MAX_RUNS_PER_HOUR"];

beforeEach(() => {
  __resetApifyGuardForTests();
  for (const key of ENV_KEYS) vi.stubEnv(key, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function goLive(options: FakeApifyOptions) {
  vi.stubEnv("APIFY_MODE", "live");
  vi.stubEnv("APIFY_API_TOKEN", TEST_TOKEN);
  vi.stubEnv("APIFY_BASE_URL", "https://api.apify.test/v2");
  return fakeApify(options);
}

const starts = (calls: { method: string; path: string }[]) => calls.filter((c) => c.method === "POST" && c.path.endsWith("/runs")).length;

describe("searchLiveListings", () => {
  it("fails with a config error when APIFY_MODE is unset", async () => {
    await expect(searchLiveListings(NEED, AFFORDABILITY, CREDIT, { constraints: CONSTRAINTS })).rejects.toMatchObject({ kind: "config" });
  });

  it("returns the demo listings in mock mode without calling Apify", async () => {
    vi.stubEnv("APIFY_MODE", "mock");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const listings = await searchLiveListings(NEED, AFFORDABILITY, CREDIT, { constraints: CONSTRAINTS });

    expect(listings.length).toBeGreaterThan(0);
    expect(listings.every((l) => l.listingUrl === undefined)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the real run's listings with their Cars.com links", async () => {
    goLive({ items: CARS_COM_RUN_ITEMS });
    const listings = await searchLiveListings(NEED, AFFORDABILITY, CREDIT, { constraints: CONSTRAINTS });
    expect(listings).toHaveLength(5);
    expect(listings.every((l) => l.listingUrl?.startsWith("https://www.cars.com/vehicledetail/"))).toBe(true);
  });

  it("sends the plan and the assessment's price ceiling to the Actor", async () => {
    const { calls } = goLive({ items: [carsComItem()] });
    const constraints: AffordableSearchConstraints = { ...CONSTRAINTS, minYear: 2017, maxMileage: 100000 };
    await searchLiveListings({ ...NEED, zip: "95823" }, AFFORDABILITY, CREDIT, { constraints, plan: { ...PLAN, bodyStyles: ["sedan"] } });
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({
      make: "Toyota",
      model: "Corolla",
      yearMin: 2017,
      priceMax: 17000,
      mileageMax: 100000,
      zip: "95823",
      searchRadius: 50,
      condition: "USED",
    });
  });

  it("asks for a make instead of starting a paid run when the plan has none", async () => {
    const { calls } = goLive({ items: [carsComItem()] });
    const err = await searchLiveListings(NEED, AFFORDABILITY, CREDIT, { constraints: CONSTRAINTS, plan: { ...PLAN, make: null } }).catch((e) => e);
    expect(err).toMatchObject({ kind: "missing_make" });
    expect(err.userMessage).toMatch(/Tell us which make/);
    expect(calls).toHaveLength(0);
  });

  it("reuses the result for an identical search instead of paying for another run", async () => {
    const { calls } = goLive({ items: [carsComItem()] });
    await searchLiveListings(NEED, AFFORDABILITY, CREDIT, { constraints: CONSTRAINTS });
    await searchLiveListings(NEED, AFFORDABILITY, CREDIT, { constraints: CONSTRAINTS });
    expect(starts(calls)).toBe(1);

    await searchLiveListings({ ...NEED, zip: "10001" }, AFFORDABILITY, CREDIT, { constraints: CONSTRAINTS });
    expect(starts(calls)).toBe(2);
  });

  it("refuses new paid runs past the hourly limit", async () => {
    const { calls } = goLive({ items: [carsComItem()] });
    vi.stubEnv("APIFY_MAX_RUNS_PER_HOUR", "1");
    await searchLiveListings(NEED, AFFORDABILITY, CREDIT, { constraints: CONSTRAINTS });
    const err = await searchLiveListings({ ...NEED, zip: "10001" }, AFFORDABILITY, CREDIT, { constraints: CONSTRAINTS }).catch((e) => e);
    expect(err).toMatchObject({ kind: "budget" });
    expect(starts(calls)).toBe(1);
  });

  it("logs drop counts without listing details", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    goLive({ items: [carsComItem(), carsComItem({ listingId: "SECRETID", priceUsd: null, vin: "SECRETVIN0000000X" })] });

    await searchLiveListings(NEED, AFFORDABILITY, CREDIT, { constraints: CONSTRAINTS });

    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain("kept 1/2");
    expect(line).not.toContain("SECRETVIN");
    expect(line).not.toContain("SECRETID");
    expect(line).not.toContain("e3cfc9e8");
  });

  it("uses partial results from a timed-out run and says so in the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    goLive({ statuses: ["RUNNING", "TIMED-OUT"], items: [carsComItem()] });
    expect(await searchLiveListings(NEED, AFFORDABILITY, CREDIT, { constraints: CONSTRAINTS })).toHaveLength(1);
    expect(String(warn.mock.calls[0][0])).toContain("(partial)");
  });

  it("treats an empty run as inconclusive, never as \"no cars for sale\", and doesn't cache it", async () => {
    const { calls } = goLive({ items: [] });
    const err = await searchLiveListings(NEED, AFFORDABILITY, CREDIT, { constraints: CONSTRAINTS }).catch((e) => e);
    expect(err).toMatchObject({ kind: "empty_result" });
    expect(err.userMessage).toMatch(/can't tell yet whether matching cars are for sale/);
    expect(err.userMessage).not.toMatch(/couldn't find used cars/);
    await searchLiveListings(NEED, AFFORDABILITY, CREDIT, { constraints: CONSTRAINTS }).catch(() => {});
    expect(starts(calls)).toBe(2);
  });

  it("says no listing matched when the plan's filters dropped them all", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    goLive({ items: [carsComItem({ bodyStyle: "Hatchback" })] });
    const err = await searchLiveListings(NEED, AFFORDABILITY, CREDIT, { constraints: CONSTRAINTS, plan: { ...PLAN, bodyStyles: ["sedan"] } }).catch((e) => e);
    expect(err).toMatchObject({ kind: "no_listings" });
    expect(err.userMessage).toMatch(/none matched the body style or fuel type/);
  });

  it("says listings lacked details when every one was dropped, never falling back to mock cars", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    goLive({ items: [carsComItem({ priceUsd: null }), carsComItem({ listingId: "2", dealer: null })] });
    const err = await searchLiveListings(NEED, AFFORDABILITY, CREDIT, { constraints: CONSTRAINTS }).catch((e) => e);
    expect(err).toMatchObject({ kind: "no_listings" });
    expect(err.userMessage).toMatch(/none had the price, mileage, and location details/);
  });

  it("propagates a live failure instead of falling back to mock listings", async () => {
    goLive({ startError: { status: 401, type: "user-or-token-not-found" } });
    const err = await searchLiveListings(NEED, AFFORDABILITY, CREDIT, { constraints: CONSTRAINTS }).catch((e) => e);
    expect(err).toBeInstanceOf(ApifyError);
    expect(err.kind).toBe("auth");
  });
});
