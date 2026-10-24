import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApifyError } from "@/lib/apify/errors";
import { __resetApifyGuardForTests } from "@/lib/apify/guard";
import { searchLiveListings } from "@/lib/providers/apify";
import { fakeApify, type FakeApifyOptions } from "./fake-apify";
import { AFFORDABILITY, autotraderItem, CREDIT, NEED, TEST_TOKEN } from "./fixtures";

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
    await expect(searchLiveListings(NEED, AFFORDABILITY, CREDIT)).rejects.toMatchObject({ kind: "config" });
  });

  it("returns the demo listings in mock mode without calling Apify", async () => {
    vi.stubEnv("APIFY_MODE", "mock");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const listings = await searchLiveListings(NEED, AFFORDABILITY, CREDIT);

    expect(listings.length).toBeGreaterThan(0);
    expect(listings.every((l) => l.listingUrl === undefined)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns mapped live listings with their AutoTrader links", async () => {
    goLive({ items: [autotraderItem(), autotraderItem({ listingId: "700000002", vin: "2HGCV1F30LA000002", model: "Accord" })] });
    const listings = await searchLiveListings(NEED, AFFORDABILITY, CREDIT);
    expect(listings.map((l) => `${l.make} ${l.model}`)).toEqual(["Honda Civic", "Honda Accord"]);
    expect(listings[0].listingUrl).toMatch(/^https:\/\/www\.autotrader\.com\//);
  });

  it("reuses the result for an identical search instead of paying for another run", async () => {
    const { calls } = goLive({ items: [autotraderItem()] });
    await searchLiveListings(NEED, AFFORDABILITY, CREDIT);
    await searchLiveListings(NEED, AFFORDABILITY, CREDIT);
    expect(starts(calls)).toBe(1);

    await searchLiveListings({ ...NEED, zip: "10001" }, AFFORDABILITY, CREDIT);
    expect(starts(calls)).toBe(2);
  });

  it("refuses new paid runs past the hourly limit", async () => {
    const { calls } = goLive({ items: [autotraderItem()] });
    vi.stubEnv("APIFY_MAX_RUNS_PER_HOUR", "1");
    await searchLiveListings(NEED, AFFORDABILITY, CREDIT);
    const err = await searchLiveListings({ ...NEED, zip: "10001" }, AFFORDABILITY, CREDIT).catch((e) => e);
    expect(err).toMatchObject({ kind: "budget" });
    expect(starts(calls)).toBe(1);
  });

  it("logs drop counts without listing details", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    goLive({ items: [autotraderItem(), autotraderItem({ salePrice: null, vin: "SECRETVIN0000000X" })] });

    await searchLiveListings(NEED, AFFORDABILITY, CREDIT);

    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain("kept 1/2");
    expect(line).not.toContain("SECRETVIN");
    expect(line).not.toContain("700000001");
  });

  it("uses partial results from a timed-out run and says so in the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    goLive({ statuses: ["RUNNING", "TIMED-OUT"], items: [autotraderItem()] });
    expect(await searchLiveListings(NEED, AFFORDABILITY, CREDIT)).toHaveLength(1);
    expect(String(warn.mock.calls[0][0])).toContain("(partial)");
  });

  it("says no cars were found when the search came back empty, and caches that", async () => {
    const { calls } = goLive({ items: [] });
    const err = await searchLiveListings(NEED, AFFORDABILITY, CREDIT).catch((e) => e);
    expect(err).toMatchObject({ kind: "no_listings" });
    expect(err.userMessage).toBe(
      "We couldn't find used cars for sale within 50 miles of 43215 in your price range. Try a nearby ZIP code or a different budget.",
    );
    await searchLiveListings(NEED, AFFORDABILITY, CREDIT).catch(() => {});
    expect(starts(calls)).toBe(1);
  });

  it("says listings lacked details when every one was dropped, never falling back to mock cars", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    goLive({ items: [autotraderItem({ salePrice: null }), autotraderItem({ listingId: "2", listingType: "NEW" })] });
    const err = await searchLiveListings(NEED, AFFORDABILITY, CREDIT).catch((e) => e);
    expect(err).toMatchObject({ kind: "no_listings" });
    expect(err.userMessage).toMatch(/none had the price, mileage, and location details/);
  });

  it("propagates a live failure instead of falling back to mock listings", async () => {
    goLive({ startError: { status: 401, type: "user-or-token-not-found" } });
    const err = await searchLiveListings(NEED, AFFORDABILITY, CREDIT).catch((e) => e);
    expect(err).toBeInstanceOf(ApifyError);
    expect(err.kind).toBe("auth");
  });
});
