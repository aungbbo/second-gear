import { describe, expect, it } from "vitest";
import { combinedMpg, daysSince, hueFor, mapListings, reliabilityFor, safeListingUrl, UNRATED_RELIABILITY } from "@/lib/apify/mapper";
import { CARS_COM_RUN_ITEMS } from "./carscom-run";
import { carsComItem, RUN_NOW } from "./fixtures";

const map = (items: unknown[], options = {}) => mapListings(items, { now: RUN_NOW, ...options });

describe("mapListings", () => {
  it("maps all five listings from the real Cars.com run", () => {
    const { listings, stats } = map(CARS_COM_RUN_ITEMS);
    expect(stats).toEqual({ received: 5, mapped: 5, incomplete: 0, filtered: 0, noMpg: 0, duplicates: 0 });
    expect(listings.map((l) => [l.year, l.trim, l.price, l.mileage, l.mpgCombined, l.city, l.state])).toEqual([
      [2021, "LE", 16998, 97590, 33, "Roseville", "CA"],
      [2017, "L", 15998, 98223, 31, "Stockton", "CA"],
      // mpgCity and mpgHighway are null on this one: the catalog's Corolla figure stands in.
      [2017, "XLE", 16903, 65000, 35, "Sacramento", "CA"],
      [2020, "LE", 14860, 83705, 33, "Sacramento", "CA"],
      [2019, "LE", 15588, 79067, 31, "Sacramento", "CA"],
    ]);
    for (const l of listings) {
      expect(l.listingUrl).toMatch(/^https:\/\/www\.cars\.com\/vehicledetail\/[0-9a-f-]+\/$/);
      expect(l.vin).toMatch(/^[A-HJ-NPR-Z0-9]{17}$/);
      expect(l.make).toBe("Toyota");
      expect(l.bodyStyle).toBe("Sedan");
    }
  });

  it("maps a complete item to CarListing", () => {
    const { listings } = map([carsComItem({ listedAt: "2026-10-02T10:41:10Z" })]);
    expect(listings).toEqual([
      {
        id: "cc_e3cfc9e8-11d9-4d4c-9272-fa995a6d3ef4",
        year: 2020,
        make: "Toyota",
        model: "Corolla",
        trim: "LE",
        bodyStyle: "Sedan",
        price: 14860,
        mileage: 83705,
        dealerName: "National Autos Sales",
        city: "Sacramento",
        state: "CA",
        daysOnMarket: 22,
        mpgCombined: 33,
        reliabilityScore: 5,
        vin: "5YFEPRAE4LP030872",
        accentHue: hueFor("e3cfc9e8-11d9-4d4c-9272-fa995a6d3ef4"),
        listingUrl: "https://www.cars.com/vehicledetail/e3cfc9e8-11d9-4d4c-9272-fa995a6d3ef4/",
      },
    ]);
  });

  it("reads the numeric price and mileage, never the string copies", () => {
    const { listings, stats } = map([carsComItem({ priceUsd: null, price: "14860" })]);
    expect(listings).toHaveLength(0);
    expect(stats.incomplete).toBe(1);
    expect(map([carsComItem({ mileageMiles: "83705" })]).stats.incomplete).toBe(1);
  });

  it("never copies dealer contact details or images", () => {
    const item = carsComItem({ images: ["https://images.example/1.jpg"], dealer: { ...(carsComItem().dealer as object), phone: "555-0100", address: "1 Main St" } });
    const json = JSON.stringify(map([item]).listings);
    expect(json).not.toContain("555-0100");
    expect(json).not.toContain("1 Main St");
    expect(json).not.toContain("images.example");
  });

  it.each([
    ["listingId", null],
    ["year", null],
    ["year", 1985],
    ["make", ""],
    ["model", null],
    ["priceUsd", null],
    ["priceUsd", 0],
    ["mileageMiles", null],
    ["mileageMiles", -1],
    ["dealer", null],
    ["dealer", { name: "X", city: null, state: "CA" }],
    ["dealer", { name: "X", city: "Sacramento", state: "" }],
  ])("drops an item whose %s is %j instead of guessing", (field, value) => {
    const { listings, stats } = map([carsComItem({ [field]: value })]);
    expect(listings).toHaveLength(0);
    expect(stats.incomplete).toBe(1);
  });

  it("drops non-object items", () => {
    expect(map([null, "x", 3]).stats.incomplete).toBe(3);
  });

  it("drops listings below the minimum price", () => {
    const { listings, stats } = map([carsComItem({ priceUsd: 2500 }), carsComItem({ listingId: "2", vin: null })], { minPrice: 3000 });
    expect(listings).toHaveLength(1);
    expect(stats.filtered).toBe(1);
  });

  it("keeps only the plan's body styles and fuel types", () => {
    const items = [
      carsComItem(),
      carsComItem({ listingId: "2", vin: null, bodyStyle: "Hatchback" }),
      carsComItem({ listingId: "3", vin: null, fuelType: "Hybrid" }),
      carsComItem({ listingId: "4", vin: null, fuelType: null }),
    ];
    expect(map(items, { bodyStyles: ["sedan"] }).listings.map((l) => l.id)).toEqual(["cc_e3cfc9e8-11d9-4d4c-9272-fa995a6d3ef4", "cc_3", "cc_4"]);
    const hybrids = map(items, { fuelTypes: ["hybrid"] });
    expect(hybrids.listings.map((l) => l.id)).toEqual(["cc_3"]);
    expect(hybrids.stats.filtered).toBe(3);
  });

  it("omits the listing URL when it is missing or not an https Cars.com link", () => {
    for (const listingUrl of [null, "", "http://www.cars.com/x", "https://cars.com.evil.test/x", "https://www.autotrader.com/x", "javascript:alert(1)"]) {
      expect(map([carsComItem({ listingUrl })]).listings[0]).not.toHaveProperty("listingUrl");
    }
  });

  it("falls back to the catalog MPG, and drops items with no MPG anywhere", () => {
    const fromCatalog = map([carsComItem({ mpgCity: null, mpgHighway: null })]);
    expect(fromCatalog.listings[0].mpgCombined).toBe(35);

    const unknown = map([carsComItem({ make: "Rivian", model: "R1T", mpgCity: null, mpgHighway: null })]);
    expect(unknown.listings).toHaveLength(0);
    expect(unknown.stats.noMpg).toBe(1);
  });

  it("drops duplicates by listing id and by VIN", () => {
    const { listings, stats } = map([
      carsComItem(),
      carsComItem(),
      carsComItem({ listingId: "2", vin: "5yfeprae4lp030872" }),
      carsComItem({ listingId: "3", vin: null }),
    ]);
    expect(listings.map((l) => l.id)).toEqual(["cc_e3cfc9e8-11d9-4d4c-9272-fa995a6d3ef4", "cc_3"]);
    expect(stats.duplicates).toBe(2);
  });

  it("fills optional fields conservatively", () => {
    const [listing] = map([
      carsComItem({ trim: null, bodyStyle: null, dealer: { city: "Sacramento", state: "CA" }, listedAt: null, vin: null, listingId: 42 }),
    ]).listings;
    expect(listing).toMatchObject({ id: "cc_42", trim: "", bodyStyle: "Sedan", dealerName: "Private seller", daysOnMarket: 0, vin: "" });
  });

  it("rounds prices and mileage", () => {
    const [listing] = map([carsComItem({ priceUsd: 15995.6, mileageMiles: 48210.4 })]).listings;
    expect(listing.price).toBe(15996);
    expect(listing.mileage).toBe(48210);
  });
});

describe("daysSince", () => {
  it("counts whole days, and ignores missing, unparsable, or future dates", () => {
    expect(daysSince("2026-10-24T03:54:38Z", RUN_NOW)).toBe(1);
    expect(daysSince("2026-10-25T03:00:00Z", RUN_NOW)).toBe(0);
    expect(daysSince(undefined, RUN_NOW)).toBeUndefined();
    expect(daysSince("soon", RUN_NOW)).toBeUndefined();
    expect(daysSince("2026-12-01T00:00:00Z", RUN_NOW)).toBeUndefined();
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
    const [listing] = map([carsComItem({ make: "Jeep", model: "Compass", mpgHighway: null, mpgCity: 24 })]).listings;
    expect(listing.mpgCombined).toBe(24);
  });
});

describe("safeListingUrl", () => {
  it("accepts https Cars.com links and strips credentials", () => {
    expect(safeListingUrl("https://www.cars.com/vehicledetail/abc/")).toBe("https://www.cars.com/vehicledetail/abc/");
    expect(safeListingUrl("https://user:pw@cars.com/a")).toBe("https://cars.com/a");
    expect(safeListingUrl("https://notcars.com/a")).toBeUndefined();
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
