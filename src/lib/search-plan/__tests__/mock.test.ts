import { describe, expect, it } from "vitest";
import { getSearchPlanner, matchesBodyStyle, matchesFuelType, normalizePlan, type VehicleSearchPlan } from "@/lib/search-plan";
import { detectMake, detectMaxMileage, detectMinYear, detectModel, mockSearchPlanner } from "@/lib/search-plan/mock";
import type { BuyerNeed } from "@/lib/types";

const need = (description: string): BuyerNeed => ({ description, maxMonthlyPayment: 400, timeframeWeeks: 4, downPayment: 0, zip: "95823" });
const plan = (description: string) => mockSearchPlanner({ need: need(description) });

describe("mockSearchPlanner", () => {
  it("plans the buyer request used for the live Cars.com test", async () => {
    expect(
      await plan(
        "I need a reliable used Toyota Corolla for commuting around Sacramento. I prefer a sedan from 2017 or newer, under 100,000 miles, and something affordable to maintain.",
      ),
    ).toEqual({
      source: "mock",
      make: "Toyota",
      model: "Corolla",
      bodyStyles: ["sedan"],
      fuelTypes: [],
      minYear: 2017,
      maxMileage: 100000,
    });
  });

  it("returns no make for a vague request rather than guessing one", async () => {
    expect(await plan("A reliable car to commute, nothing fancy.")).toMatchObject({ make: null, model: null });
  });

  it("returns no make when several are named", async () => {
    expect((await plan("Honda or Toyota, either is fine")).make).toBeNull();
  });

  it("maps body style and fuel words", async () => {
    expect(await plan("a Honda SUV")).toMatchObject({ make: "Honda", model: null, bodyStyles: ["suv"] });
    expect((await plan("a Toyota hybrid to save on gas")).fuelTypes).toEqual(["hybrid"]);
    expect((await plan("an electric Hyundai")).fuelTypes).toEqual(["electric"]);
  });

  it("is the planner the pipeline uses until Bitdeer is connected", () => {
    expect(getSearchPlanner()).toBe(mockSearchPlanner);
  });
});

describe("detectors", () => {
  it("does not match makes inside other words", () => {
    expect(detectMake("a ramble about cars")).toBeUndefined();
    expect(detectMake("need a ram 1500")).toBe("Ram");
    expect(detectMake("my old chevy died")).toBe("Chevrolet");
  });

  it("finds a catalog model of the named make only", () => {
    expect(detectModel("a toyota corolla", "Toyota")).toBe("Corolla");
    expect(detectModel("a toyota civic", "Toyota")).toBeUndefined();
  });

  it("reads a minimum year and a mileage cap, never a price", () => {
    expect(detectMinYear("2017 or newer")).toBe(2017);
    expect(detectMinYear("a 2019+ model")).toBe(2019);
    expect(detectMinYear("under $17,000")).toBeUndefined();
    expect(detectMaxMileage("under 100,000 miles")).toBe(100000);
    expect(detectMaxMileage("less than 80k mi")).toBe(80000);
    expect(detectMaxMileage("under $17,000")).toBeUndefined();
  });
});

describe("plan filters", () => {
  it("matches Cars.com body styles and fuel types", () => {
    expect(matchesBodyStyle("Sedan", ["sedan"])).toBe(true);
    expect(matchesBodyStyle("Sport Utility", ["suv"])).toBe(true);
    expect(matchesBodyStyle("Hatchback", ["sedan"])).toBe(false);
    expect(matchesBodyStyle(undefined, ["sedan"])).toBe(false);
    expect(matchesBodyStyle(undefined, [])).toBe(true);
    expect(matchesFuelType("Hybrid", ["hybrid"])).toBe(true);
    expect(matchesFuelType("Gasoline", ["hybrid"])).toBe(false);
    expect(matchesFuelType(undefined, [])).toBe(true);
  });
});

describe("normalizePlan", () => {
  it("keeps only known fields and sane values, so a planner can't smuggle in money or location", () => {
    const raw = {
      source: "bitdeer", make: "  Toyota ", model: "", bodyStyles: ["sedan", "spaceship", "sedan"], fuelTypes: ["diesel"],
      minYear: 2017.5, maxMileage: -5, priceMax: 99999, zip: "10001",
    } as unknown as VehicleSearchPlan;
    const plan = normalizePlan(raw, new Date("2026-10-25T00:00:00Z"));
    expect(plan).toEqual({ source: "bitdeer", make: "Toyota", model: null, bodyStyles: ["sedan"], fuelTypes: [], minYear: null, maxMileage: null });
    expect(plan).not.toHaveProperty("priceMax");
    expect(plan).not.toHaveProperty("zip");
  });
});
