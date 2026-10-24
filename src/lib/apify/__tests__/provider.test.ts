import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApifyError } from "@/lib/apify/errors";
import { searchLiveListings } from "@/lib/providers/apify";
import { AFFORDABILITY, autotraderItem, CREDIT, NEED, TEST_TOKEN } from "./fixtures";

const ENV_KEYS = ["APIFY_MODE", "APIFY_API_TOKEN", "APIFY_BASE_URL"];

beforeEach(() => {
  for (const key of ENV_KEYS) vi.stubEnv(key, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function goLive(response: () => Response) {
  vi.stubEnv("APIFY_MODE", "live");
  vi.stubEnv("APIFY_API_TOKEN", TEST_TOKEN);
  vi.stubEnv("APIFY_BASE_URL", "https://api.apify.test/v2");
  const fetchMock = vi.fn(async () => response());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const items = (list: unknown[]) => () => new Response(JSON.stringify(list), { status: 201 });

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
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns mapped live listings", async () => {
    goLive(items([autotraderItem(), autotraderItem({ listingId: "700000002", vin: "2HGCV1F30LA000002", model: "Accord" })]));
    const listings = await searchLiveListings(NEED, AFFORDABILITY, CREDIT);
    expect(listings.map((l) => `${l.make} ${l.model}`)).toEqual(["Honda Civic", "Honda Accord"]);
  });

  it("logs drop counts without listing details", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    goLive(items([autotraderItem(), autotraderItem({ salePrice: null, vin: "SECRETVIN0000000X" })]));

    await searchLiveListings(NEED, AFFORDABILITY, CREDIT);

    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain("kept 1/2");
    expect(line).not.toContain("SECRETVIN");
    expect(line).not.toContain("700000001");
  });

  it("throws no_listings instead of falling back to mock listings when nothing is usable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    goLive(items([autotraderItem({ salePrice: null })]));
    await expect(searchLiveListings(NEED, AFFORDABILITY, CREDIT)).rejects.toMatchObject({ kind: "no_listings" });

    goLive(items([]));
    await expect(searchLiveListings(NEED, AFFORDABILITY, CREDIT)).rejects.toMatchObject({ kind: "no_listings" });
  });

  it("propagates a live failure instead of falling back to mock listings", async () => {
    goLive(() => new Response(JSON.stringify({ error: { type: "user-or-token-not-found" } }), { status: 401 }));
    const err = await searchLiveListings(NEED, AFFORDABILITY, CREDIT).catch((e) => e);
    expect(err).toBeInstanceOf(ApifyError);
    expect(err.kind).toBe("auth");
  });
});
