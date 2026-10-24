import { describe, expect, it } from "vitest";
import { buildSearchInput, detectMake, priceCeiling } from "@/lib/apify/search";
import { principalForPayment } from "@/lib/calculations";
import { AFFORDABILITY, CREDIT, LIVE_CFG, NEED } from "./fixtures";

const input = (description: string, extra: Partial<typeof NEED> = {}) =>
  buildSearchInput({ ...NEED, description, ...extra }, AFFORDABILITY, CREDIT, LIVE_CFG);

describe("buildSearchInput", () => {
  it("sends location, price bounds and caps, but never the free text", () => {
    const result = input("A reliable car to commute, nothing fancy.");
    expect(result).toEqual({
      zip: "43215",
      searchRadius: "50",
      minPrice: 3000,
      maxPrice: priceCeiling(NEED, AFFORDABILITY, CREDIT),
      maxItems: 25,
      sortBy: "relevance",
    });
  });

  it("uses a single named make as the keyword", () => {
    expect(input("Looking for a used Toyota").keyword).toBe("Toyota");
    expect(input("my old chevy died").keyword).toBe("Chevrolet");
  });

  it("omits the keyword when several makes are named", () => {
    expect(input("Honda or Toyota, either is fine").keyword).toBeUndefined();
  });

  it("does not match makes inside other words", () => {
    expect(detectMake("a ramble about cars")).toBeUndefined();
    expect(detectMake("need a ram 1500")).toBe("Ram");
  });

  it.each([
    ["small SUV for the family", "SUVCROSS"],
    ["a pickup for work", "TRUCKS"],
    ["minivan with sliding doors", "VANMV"],
    ["hatchback, easy to park", "HATCH"],
    ["plain sedan", "SEDAN"],
  ])("maps %j to vehicleStyleCode %s", (description, code) => {
    expect(input(description).vehicleStyleCode).toBe(code);
  });

  it("maps hybrid and electric to the fuel filter", () => {
    expect(input("a hybrid to save on gas").fuelTypeGroup).toBe("HYB");
    expect(input("an electric commuter").fuelTypeGroup).toBe("ELE");
    expect(input("a commuter").fuelTypeGroup).toBeUndefined();
  });
});

describe("priceCeiling", () => {
  it("is what the safe payment finances over 72 months at the best APR, plus 20% headroom", () => {
    const financeable = principalForPayment(400, 13, 72);
    expect(priceCeiling(NEED, AFFORDABILITY, CREDIT)).toBe(Math.round((financeable * 1.2) / 500) * 500);
  });

  it("adds the down payment", () => {
    const base = priceCeiling(NEED, AFFORDABILITY, CREDIT);
    expect(priceCeiling({ ...NEED, downPayment: 2000 }, AFFORDABILITY, CREDIT)).toBe(base + 2000);
  });

  it("never drops below the minimum search price", () => {
    expect(priceCeiling(NEED, { ...AFFORDABILITY, maxSustainablePayment: 10 }, CREDIT)).toBe(4000);
  });
});
