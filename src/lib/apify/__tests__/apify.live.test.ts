import { describe, expect, it } from "vitest";
import { getApifyConfig } from "@/lib/apify/config";
import { searchLiveListings } from "@/lib/providers/apify";
import { AFFORDABILITY, CREDIT, NEED } from "./fixtures";

/**
 * ONE billed run of the real listings Actor (10 listings, $0.10 cap). Opt in with:
 *   APIFY_LIVE_TEST=1 APIFY_MODE=live APIFY_API_TOKEN=... npm test -- apify.live
 */
describe.skipIf(process.env.APIFY_LIVE_TEST !== "1")("Apify listings Actor (live, billed)", () => {
  it("returns used-car listings that map to CarListing", { timeout: 200_000 }, async () => {
    process.env.APIFY_MAX_ITEMS = "10";
    process.env.APIFY_MAX_CHARGE_USD = "0.1";
    if (getApifyConfig().mode !== "live") throw new Error("APIFY_LIVE_TEST=1 requires APIFY_MODE=live");

    const listings = await searchLiveListings(NEED, AFFORDABILITY, CREDIT);

    expect(listings.length).toBeGreaterThan(0);
    for (const l of listings) {
      expect(l.id).toMatch(/^at_/);
      expect(l.price).toBeGreaterThan(0);
      expect(l.mileage).toBeGreaterThanOrEqual(0);
      expect(l.mpgCombined).toBeGreaterThan(0);
      expect(l.city && l.state).toBeTruthy();
    }
  });
});
