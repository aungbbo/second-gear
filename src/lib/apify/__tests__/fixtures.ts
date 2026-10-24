import type { LiveApifyConfig } from "@/lib/apify/config";
import type { AffordabilityResult, BuyerNeed, CreditReport } from "@/lib/types";

/** Synthetic token in Apify's format; never a real one. */
export const TEST_TOKEN = "apify_api_TESTtokenTESTtokenTESTtoken0000";

export const LIVE_CFG: LiveApifyConfig = {
  mode: "live",
  token: TEST_TOKEN,
  actorId: "caffein.dev/autotrader-com-actor",
  baseUrl: "https://api.apify.test/v2",
  searchRadius: "50",
  maxItems: 25,
  maxChargeUsd: 0.25,
  timeoutSecs: 120,
  maxRunsPerHour: 10,
  dailyBudgetUsd: 2,
  maxConcurrentRuns: 2,
  cacheTtlSecs: 900,
};

export const NEED: BuyerNeed = {
  description: "A reliable car to commute, nothing fancy.",
  maxMonthlyPayment: 400,
  timeframeWeeks: 4,
  downPayment: 0,
  zip: "43215",
};

export const AFFORDABILITY: AffordabilityResult = {
  avgMonthlyIncome: 3450,
  essentialExpenses: 1530,
  existingDebtPayments: 180,
  discretionaryBuffer: 500,
  maxSustainablePayment: 400,
  recommendedPayment: 350,
  savingsBalance: 2400,
  cashAvailableForDown: 1200,
  incomeVolatility: "low",
  summary: "test",
};

export const CREDIT: CreditReport = {
  score: 587,
  tier: "subprime",
  tierLabel: "Subprime",
  scoreRangeLabel: "580–619",
  factors: [],
  estimatedApr: { min: 13, max: 18 },
  hardInquiriesLast6mo: 1,
  summary: "test",
};

/** Shaped like the Actor's declared dataset schema; all values synthetic. */
export function autotraderItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    listingId: "700000001",
    vin: "1hgcv1f30la000001",
    url: "https://www.autotrader.com/cars-for-sale/vehicledetails.xhtml?listingId=700000001",
    title: "Used 2019 Honda Civic LX",
    year: 2019,
    make: "Honda",
    model: "Civic",
    trim: "LX",
    bodyStyle: "Sedan",
    salePrice: 15995,
    mileage: 48210,
    mpgCity: 30,
    mpgHighway: 38,
    listingType: "USED",
    daysOnSite: 12,
    sellerName: "Example Motors",
    sellerPhone: "555-0100",
    sellerCity: "Columbus",
    sellerState: "OH",
    images: ["https://images.example/1.jpg"],
    ...overrides,
  };
}
