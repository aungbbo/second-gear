import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RankedCar } from "@/lib/types";

// Render the row expanded, where the link lives.
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return { ...react, useState: (initial: unknown) => [initial === false ? true : initial, () => {}] };
});

const { CarRow } = await import("@/components/flow/CarRow");

const scenario = {
  termMonths: 60, apr: 15, downPayment: 0, amountFinanced: 15000, monthlyPayment: 357,
  totalInterest: 6400, totalCost: 21400, negativeEquityMonths: 20, withinBudget: true,
};

function car(listingUrl?: string): RankedCar {
  return {
    rank: 1, matchScore: 90, headline: "Best fit", explanation: "Fits the budget.", warnings: [],
    bestScenario: scenario, allScenarios: [scenario], estimatedValueAt36mo: 9000,
    listing: {
      id: "at_1", year: 2019, make: "Honda", model: "Civic", trim: "LX", bodyStyle: "Sedan", price: 15000,
      mileage: 48000, dealerName: "Example Motors", city: "Columbus", state: "OH", daysOnMarket: 12,
      mpgCombined: 33, reliabilityScore: 5, vin: "", accentHue: 120, ...(listingUrl ? { listingUrl } : {}),
    },
  };
}

describe("CarRow", () => {
  it("links to the listing in a new tab, without passing the opener", () => {
    const html = renderToStaticMarkup(createElement(CarRow, { car: car("https://www.autotrader.com/a?listingId=1") }));
    expect(html).toContain('href="https://www.autotrader.com/a?listingId=1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("View listing");
  });

  it("shows no link for listings without one, such as mock listings", () => {
    expect(renderToStaticMarkup(createElement(CarRow, { car: car() }))).not.toContain("View listing");
  });
});
