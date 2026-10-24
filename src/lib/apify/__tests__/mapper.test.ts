import { describe, expect, it } from "vitest";
import { combinedMpg, hueFor, isUsedListing, mapListings, reliabilityFor, safeListingUrl, UNRATED_RELIABILITY } from "@/lib/apify/mapper";
import { autotraderItem } from "./fixtures";

describe("mapListings", () => {
  it("maps a complete item to CarListing", () => {
    const { listings, stats } = mapListings([autotraderItem()]);
    expect(listings).toEqual([
      {
        id: "at_700000001",
        year: 2019,
        make: "Honda",
        model: "Civic",
        trim: "LX",
        bodyStyle: "Sedan",
        price: 15995,
        mileage: 48210,
        dealerName: "Example Motors",
        city: "Columbus",
        state: "OH",
        daysOnMarket: 12,
        mpgCombined: 33,
        reliabilityScore: 5,
        vin: "1HGCV1F30LA000001",
        accentHue: hueFor("700000001"),
        listingUrl: "https://www.autotrader.com/cars-for-sale/vehicledetails.xhtml?listingId=700000001",
      },
    ]);
    expect(stats).toEqual({ received: 1, mapped: 1, incomplete: 0, notUsed: 0, noMpg: 0, duplicates: 0 });
  });

  it("never copies seller contact details or images", () => {
    const json = JSON.stringify(mapListings([autotraderItem()]).listings);
    expect(json).not.toContain("555-0100");
    expect(json).not.toContain("images.example");
  });

  it.each([
    ["listingId", null],
    ["year", null],
    ["year", 1985],
    ["make", ""],
    ["model", null],
    ["salePrice", null],
    ["salePrice", 0],
    ["mileage", null],
    ["mileage", -1],
    ["sellerCity", null],
    ["sellerState", null],
  ])("drops an item whose %s is %j instead of guessing", (field, value) => {
    const { listings, stats } = mapListings([autotraderItem({ [field]: value })]);
    expect(listings).toHaveLength(0);
    expect(stats.incomplete).toBe(1);
  });

  it("drops non-object items", () => {
    expect(mapListings([null, "x", 3]).stats.incomplete).toBe(3);
  });

  it("keeps used and certified pre-owned listings, and drops new ones", () => {
    for (const listingType of ["USED", "CERTIFIED", "3P_CERT", "certified"]) {
      expect(mapListings([autotraderItem({ listingType })]).listings).toHaveLength(1);
    }
    for (const listingType of ["NEW", "LEASE"]) {
      expect(mapListings([autotraderItem({ listingType })]).stats.notUsed).toBe(1);
    }
  });

  it("falls back to the title when the listing type is missing", () => {
    expect(mapListings([autotraderItem({ listingType: null, title: "New 2026 Honda Civic LX" })]).stats.notUsed).toBe(1);
    expect(mapListings([autotraderItem({ listingType: null, title: "Certified 2019 Honda Civic LX" })]).listings).toHaveLength(1);
    expect(mapListings([autotraderItem({ listingType: null, title: null })]).listings).toHaveLength(1);
  });

  it("omits the listing URL when it is missing or not an https AutoTrader link", () => {
    for (const url of [null, "", "http://www.autotrader.com/x", "https://autotrader.com.evil.test/x", "javascript:alert(1)"]) {
      expect(mapListings([autotraderItem({ url })]).listings[0]).not.toHaveProperty("listingUrl");
    }
  });

  it("falls back to the catalog MPG, and drops items with no MPG anywhere", () => {
    const fromCatalog = mapListings([autotraderItem({ mpgCity: null, mpgHighway: null })]);
    expect(fromCatalog.listings[0].mpgCombined).toBe(34);

    const unknown = mapListings([autotraderItem({ make: "Rivian", model: "R1T", mpgCity: null, mpgHighway: null })]);
    expect(unknown.listings).toHaveLength(0);
    expect(unknown.stats.noMpg).toBe(1);
  });

  it("drops duplicates by listing id and by VIN", () => {
    const { listings, stats } = mapListings([
      autotraderItem(),
      autotraderItem(),
      autotraderItem({ listingId: "700000002", vin: "1HGCV1F30LA000001" }),
      autotraderItem({ listingId: "700000003", vin: null }),
    ]);
    expect(listings.map((l) => l.id)).toEqual(["at_700000001", "at_700000003"]);
    expect(stats.duplicates).toBe(2);
  });

  it("fills optional fields conservatively", () => {
    const [listing] = mapListings([
      autotraderItem({ trim: null, bodyStyle: null, sellerName: null, daysOnSite: null, vin: null, listingId: 42 }),
    ]).listings;
    expect(listing).toMatchObject({ id: "at_42", trim: "", bodyStyle: "Sedan", dealerName: "Private seller", daysOnMarket: 0, vin: "" });
  });

  it("rounds prices and mileage", () => {
    const [listing] = mapListings([autotraderItem({ salePrice: 15995.6, mileage: 48210.4 })]).listings;
    expect(listing.price).toBe(15996);
    expect(listing.mileage).toBe(48210);
  });
});

describe("combinedMpg", () => {
  it("uses the EPA 55/45 harmonic weighting", () => {
    expect(combinedMpg(30, 38)).toBe(33);
  });

  it("uses a city-only figure, never a highway-only one", () => {
    expect(combinedMpg(28, undefined)).toBe(28);
    expect(combinedMpg(28, 0)).toBe(28);
    expect(combinedMpg(undefined, 38)).toBeUndefined();
    expect(combinedMpg(0, 38)).toBeUndefined();
  });

  it("keeps a car outside the catalog that lists only city MPG", () => {
    const [listing] = mapListings([autotraderItem({ make: "Jeep", model: "Compass", mpgHighway: null, mpgCity: 24 })]).listings;
    expect(listing.mpgCombined).toBe(24);
  });
});

describe("isUsedListing", () => {
  it("accepts AutoTrader's used types only", () => {
    expect(isUsedListing("USED", undefined)).toBe(true);
    expect(isUsedListing("3P_CERT", undefined)).toBe(true);
    expect(isUsedListing("NEW", "Used 2019 Honda Civic")).toBe(false);
    expect(isUsedListing(undefined, "New 2026 Honda Civic")).toBe(false);
    expect(isUsedListing(undefined, "Newport Blue 2019 Civic")).toBe(true);
  });
});

describe("safeListingUrl", () => {
  it("accepts https AutoTrader links and strips credentials", () => {
    expect(safeListingUrl("https://www.autotrader.com/a?listingId=1")).toBe("https://www.autotrader.com/a?listingId=1");
    expect(safeListingUrl("https://user:pw@autotrader.com/a")).toBe("https://autotrader.com/a");
    expect(safeListingUrl("not a url")).toBeUndefined();
  });
});

describe("reliabilityFor", () => {
  it("uses the catalog model, then the make average, then neutral", () => {
    expect(reliabilityFor("toyota", "COROLLA")).toBe(5);
    expect(reliabilityFor("Toyota", "RAV4")).toBe(5);
    expect(reliabilityFor("Nissan", "Rogue")).toBe(3);
    expect(reliabilityFor("Jeep", "Compass")).toBe(UNRATED_RELIABILITY);
  });
});

describe("hueFor", () => {
  it("is stable and within 0–359", () => {
    expect(hueFor("abc")).toBe(hueFor("abc"));
    for (const id of ["1", "700000001", "zzzzzzzz"]) {
      expect(hueFor(id)).toBeGreaterThanOrEqual(0);
      expect(hueFor(id)).toBeLessThan(360);
    }
  });
});
