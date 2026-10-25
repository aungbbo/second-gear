import type { LiveApifyConfig } from "@/lib/apify/config";
import type { VehicleSearchPlan } from "@/lib/search-plan";
import type { AffordabilityResult, AffordableSearchConstraints, BuyerNeed, CreditReport } from "@/lib/types";
import { CARS_COM_RUN_ITEMS } from "./carscom-run";

/** Synthetic token in Apify's format; never a real one. */
export const TEST_TOKEN = "apify_api_TESTtokenTESTtokenTESTtoken0000";

export const LIVE_CFG: LiveApifyConfig = {
  mode: "live",
  token: TEST_TOKEN,
  actorId: "skootle/cars-com-scraper",
  baseUrl: "https://api.apify.test/v2",
  maxItems: 25,
  maxChargeUsd: 0.25,
  timeoutSecs: 120,
  maxRunsPerHour: 10,
  dailyBudgetUsd: 2,
  maxConcurrentRuns: 2,
  cacheTtlSecs: 900,
};

export const NEED: BuyerNeed = {
  description: "A reliable used Toyota Corolla to commute, nothing fancy.",
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

/** Deterministic limits as the assessment would produce them: a $17,000 ceiling, no buyer radius or year/mileage preference. */
export const CONSTRAINTS: AffordableSearchConstraints = {
  zip: "95823",
  radiusMiles: null,
  minPrice: 0,
  maxPrice: 17000,
  maxMonthlyLoanPayment: 320,
  maxMonthlyVehicleCost: 520,
  maxMileage: null,
  minYear: null,
  vehicleTypes: [],
  preferredTermMonths: 60,
  allowedTermsMonths: [36, 48, 60, 72],
  assumptions: [],
};

/**
 * Cash flow that leaves room for a car: with NEED at $800/month in 95823 the
 * assessment's maximum affordable vehicle price is $18,700, above all five
 * listings of the real run. (AFFORDABILITY leaves only $2,100, below the
 * $3,000 minimum, so a live search with it never starts.)
 */
export const ROOMY_AFFORDABILITY: AffordabilityResult = {
  ...AFFORDABILITY,
  avgMonthlyIncome: 8000,
  essentialExpenses: 2800,
  discretionaryBuffer: 5020,
  maxSustainablePayment: 900,
  recommendedPayment: 850,
  savingsBalance: 15000,
  cashAvailableForDown: 5000,
};
export const ROOMY_NEED: BuyerNeed = { ...NEED, maxMonthlyPayment: 800, zip: "95823" };

/** What the mock planner reads from NEED's description. */
export const PLAN: VehicleSearchPlan = {
  source: "mock",
  make: "Toyota",
  model: "Corolla",
  bodyStyles: [],
  fuelTypes: [],
  minYear: null,
  maxMileage: null,
};

/** Clock pinned to the real run's scrape time (2026-10-25T03:54:38Z). */
export const RUN_NOW = Date.parse("2026-10-25T03:54:38.333Z");

/** A real item from the Cars.com test run (the 2020 Corolla LE in ZIP 95823), with overrides. */
export function carsComItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...structuredClone(CARS_COM_RUN_ITEMS[3]), ...overrides };
}
