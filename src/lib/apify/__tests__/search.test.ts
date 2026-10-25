import { describe, expect, it } from "vitest";
import { buildSearchInput, MIN_PRICE, searchMaxPrice } from "@/lib/apify/search";
import type { VehicleSearchPlan } from "@/lib/search-plan";
import type { AffordableSearchConstraints } from "@/lib/types";
import { CONSTRAINTS, LIVE_CFG, NEED, PLAN } from "./fixtures";

const NOW = new Date("2026-10-25T12:00:00Z");

const input = (plan: Partial<VehicleSearchPlan> = {}, constraints: AffordableSearchConstraints = CONSTRAINTS) =>
  buildSearchInput({ need: { ...NEED, zip: "95823" }, constraints, plan: { ...PLAN, ...plan } }, LIVE_CFG, NOW);

describe("buildSearchInput", () => {
  it("builds the input of the tested Cars.com run from the Corolla plan and a $17,000 assessment", () => {
    expect(input({ minYear: 2017, maxMileage: 100000 })).toEqual({
      make: "Toyota",
      model: "Corolla",
      yearMin: 2017,
      yearMax: 2027,
      priceMax: 17000,
      mileageMax: 100000,
      zip: "95823",
      searchRadius: 50,
      condition: "USED",
      maxItems: 25,
    });
  });

  it("always sends every field, so the Actor's BMW / 3 Series / 2020–2024 defaults never apply", () => {
    const result = input({ model: null, minYear: null, maxMileage: null });
    expect(result).toMatchObject({ make: "Toyota", model: "", yearMin: 1990, yearMax: 2027, mileageMax: 0 });
  });

  it.each([
    ["no make", null],
    ["a blank make", "  "],
  ])("refuses to search with %s instead of defaulting to one", (_, make) => {
    expect(() => input({ make })).toThrow(expect.objectContaining({ kind: "missing_make" }));
  });

  it("takes the stricter year and mileage of the plan and the buyer's preferences", () => {
    const constraints = { ...CONSTRAINTS, minYear: 2019, maxMileage: 80000 };
    expect(input({ minYear: 2017, maxMileage: 100000 }, constraints)).toMatchObject({ yearMin: 2019, mileageMax: 80000 });
    expect(input({ minYear: 2021, maxMileage: 60000 }, constraints)).toMatchObject({ yearMin: 2021, mileageMax: 60000 });
  });

  it("uses the buyer's radius when given, else the configured one", () => {
    expect(input({}, { ...CONSTRAINTS, radiusMiles: 25 }).searchRadius).toBe(25);
    expect(input({}, CONSTRAINTS).searchRadius).toBe(50);
  });

  it("ignores money, location and unknown values a planner slips into the plan", () => {
    const sneaky = { ...PLAN, priceMax: 99999, maxPrice: 99999, zip: "10001", searchRadius: 500, bodyStyles: ["spaceship"], minYear: 1850 } as unknown as VehicleSearchPlan;
    const result = buildSearchInput({ need: { ...NEED, zip: "95823" }, constraints: CONSTRAINTS, plan: sneaky }, LIVE_CFG, NOW);
    expect(result).toMatchObject({ priceMax: 17000, zip: "95823", searchRadius: 50, yearMin: 1990 });
  });

  it("refuses to search when the assessment leaves no room above the minimum price", () => {
    for (const maxPrice of [0, 2100, MIN_PRICE, Number.NaN]) {
      expect(() => input({}, { ...CONSTRAINTS, maxPrice })).toThrow(expect.objectContaining({ kind: "no_affordable_price" }));
    }
  });
});

describe("searchMaxPrice", () => {
  it("is the assessment's maximum affordable vehicle price, rounded down", () => {
    expect(searchMaxPrice(CONSTRAINTS)).toBe(17000);
    expect(searchMaxPrice({ ...CONSTRAINTS, maxPrice: 12345.9 })).toBe(12345);
    expect(searchMaxPrice({ ...CONSTRAINTS, maxPrice: MIN_PRICE + 1 })).toBe(MIN_PRICE + 1);
  });
});
