import { describe, expect, it } from "vitest";
import { buildAllScenarios, buildLoanScenario, monthlyPayment } from "@/lib/calculations";
import { assessAffordability } from "@/lib/affordability/assessment";
import { buildAffordableSearchConstraints } from "@/lib/affordability/constraints";
import { calculateOwnershipCosts } from "@/lib/affordability/ownership";
import { evaluateVehicle } from "@/lib/affordability/vehicle";
import type { AffordabilityResult, BuyerNeed, CarListing, CreditReport } from "@/lib/types";

const NEED: BuyerNeed = {
  description: "reliable sedan",
  maxMonthlyPayment: 600,
  timeframeWeeks: 4,
  downPayment: 1_000,
  zip: "43215",
  searchPreferences: { radiusMiles: 40, maxMileage: 100_000, minYear: 2018, vehicleTypes: ["sedan"] },
};

const CREDIT: CreditReport = {
  score: 720,
  tier: "prime",
  tierLabel: "Prime",
  scoreRangeLabel: "700+",
  factors: [],
  estimatedApr: { min: 5, max: 8 },
  hardInquiriesLast6mo: 1,
  summary: "Synthetic report",
};

const DEEP_SUBPRIME: CreditReport = {
  ...CREDIT,
  score: 540,
  tier: "deep-subprime",
  tierLabel: "Deep subprime",
  scoreRangeLabel: "300–579",
  estimatedApr: { min: 18, max: 24 },
};

const CASH_FLOW: AffordabilityResult = {
  avgMonthlyIncome: 5_000,
  essentialExpenses: 1_800,
  existingDebtPayments: 300,
  discretionaryBuffer: 2_900,
  maxSustainablePayment: 1_000,
  recommendedPayment: 880,
  savingsBalance: 12_000,
  cashAvailableForDown: 5_000,
  incomeVolatility: "low",
  summary: "Synthetic cash flow",
};

const LOW_CAPACITY: AffordabilityResult = {
  ...CASH_FLOW,
  avgMonthlyIncome: 2_000,
  essentialExpenses: 1_500,
  existingDebtPayments: 450,
  discretionaryBuffer: 50,
  maxSustainablePayment: 100,
  recommendedPayment: 80,
  savingsBalance: 100,
  cashAvailableForDown: 0,
  incomeVolatility: "high",
};

const LISTING: CarListing = {
  id: "synthetic-1",
  year: 2020,
  make: "Toyota",
  model: "Corolla",
  trim: "LE",
  bodyStyle: "Sedan",
  price: 12_000,
  mileage: 60_000,
  dealerName: "Synthetic Motors",
  city: "Columbus",
  state: "OH",
  daysOnMarket: 10,
  mpgCombined: 35,
  reliabilityScore: 5,
  vin: "SYNTHETICVIN00001",
  accentHue: 10,
};

describe("loan calculations", () => {
  it("supports zero-interest amortization without division by zero", () => {
    expect(monthlyPayment(12_000, 0, 60)).toBe(200);
    const scenario = buildLoanScenario(12_000, 0, 0, 0, 60, 250);
    expect(scenario.amountFinanced).toBe(12_000);
    expect(scenario.monthlyPayment).toBe(200);
    expect(scenario.totalInterest).toBe(0);
    expect(scenario.totalFinancingCost).toBe(12_000);
  });

  it("raises the estimated APR as the loan term gets longer", () => {
    const scenarios = buildAllScenarios(15_000, 1_000, 19.1, 19.1, 600);

    expect(scenarios.map((scenario) => scenario.apr)).toEqual([19.1, 19.35, 19.85, 20.6]);
    expect(scenarios[0].apr).toBeLessThan(scenarios[1].apr);
    expect(scenarios[1].apr).toBeLessThan(scenarios[2].apr);
    expect(scenarios[2].apr).toBeLessThan(scenarios[3].apr);
    expect(scenarios[0].totalInterest).toBeLessThan(scenarios[3].totalInterest);
  });

  it("calculates all required loan terms and 36-month equity exposure", () => {
    const scenarios = buildAllScenarios(15_000, 1_000, 18, 24, 600);
    expect(scenarios.map((scenario) => scenario.termMonths)).toEqual([36, 48, 60, 72]);
    for (const scenario of scenarios) {
      expect(scenario.totalFinancingCost).toBeGreaterThanOrEqual(scenario.amountFinanced);
      expect(scenario.remainingBalanceAt36Months).toBeGreaterThanOrEqual(0);
      expect(scenario.estimatedValueAt36Months).toBeGreaterThan(0);
      expect(scenario.negativeEquityAt36Months).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("ownership costs", () => {
  it("uses buyer-provided values and keeps dealer fees upfront", () => {
    const costs = calculateOwnershipCosts({
      listingPrice: 20_000,
      mpgCombined: 30,
      monthlyLoanPayment: 300,
      downPayment: 2_000,
      overrides: {
        insuranceMonthly: 220,
        fuelMonthly: 140,
        maintenanceMonthly: 80,
        registrationAndTaxesMonthly: 30,
        otherMonthly: 25,
        dealerFees: 900,
      },
    });
    expect(costs.recurringMonthly).toBe(495);
    expect(costs.totalMonthlyCost).toBe(795);
    expect(costs.upfrontCashNeeded).toBe(2_900);
    expect(costs.estimateNotes).toHaveLength(0);
  });
});

describe("affordability assessment", () => {
  it("separates the stated budget from the sustainable loan payment and price", () => {
    const assessment = assessAffordability(NEED, CREDIT, CASH_FLOW);
    expect(assessment.statedMonthlyBudget).toBe(600);
    expect(assessment.sustainableMonthlyVehicleCost).toBe(600);
    expect(assessment.maxSustainableLoanPayment).toBeLessThan(600);
    expect(assessment.maxAffordableVehiclePrice).toBeGreaterThan(0);
    expect(assessment.preferredTermMonths).toBe(60);
    expect(assessment.summary).toContain("application-generated");
  });

  it("does not invent a payment floor when the buyer has no capacity", () => {
    const assessment = assessAffordability({ ...NEED, maxMonthlyPayment: 500 }, DEEP_SUBPRIME, LOW_CAPACITY);
    expect(assessment.maxSustainableLoanPayment).toBe(0);
    expect(assessment.maxAffordableVehiclePrice).toBe(0);
    expect(assessment.recommendedPurchase).toBe(false);
    expect(assessment.warnings).toContain("No vehicle purchase is financially sustainable under the current inputs.");
  });

  it("flags debt, volatility, thin savings, and high APR risk", () => {
    const assessment = assessAffordability({ ...NEED, maxMonthlyPayment: 2_000 }, DEEP_SUBPRIME, {
      ...LOW_CAPACITY,
      avgMonthlyIncome: 2_000,
      existingDebtPayments: 900,
      maxSustainablePayment: 400,
      savingsBalance: 200,
    });
    expect(assessment.riskIndicators.map((indicator) => indicator.code)).toEqual(
      expect.arrayContaining(["thin_reserves", "high_debt_burden", "income_volatility", "high_apr_estimate"]),
    );
  });
});

describe("vehicle decisions and search constraints", () => {
  it("returns an affordable decision when loan plus ownership costs fit", () => {
    const assessment = assessAffordability(NEED, CREDIT, CASH_FLOW);
    const scenarios = buildAllScenarios(LISTING.price, 1_000, CREDIT.estimatedApr.min, CREDIT.estimatedApr.max, assessment.maxSustainableLoanPayment);
    const evaluation = evaluateVehicle(LISTING, scenarios, assessment);
    expect(evaluation.decision.status).toBe("affordable");
    expect(evaluation.decision.recommendedPurchase).toBe(true);
    expect(evaluation.ownershipCosts.totalMonthlyCost).toBeLessThanOrEqual(assessment.sustainableMonthlyVehicleCost);
  });

  it("returns financially risky for a high APR profile even when the payment fits", () => {
    const assessment = assessAffordability({ ...NEED, maxMonthlyPayment: 2_000 }, DEEP_SUBPRIME, {
      ...CASH_FLOW,
      maxSustainablePayment: 2_000,
      recommendedPayment: 1_760,
    });
    const scenarios = buildAllScenarios(8_000, 0, DEEP_SUBPRIME.estimatedApr.min, DEEP_SUBPRIME.estimatedApr.max, assessment.maxSustainableLoanPayment);
    const evaluation = evaluateVehicle({ ...LISTING, price: 8_000 }, scenarios, assessment);
    expect(evaluation.decision.status).toBe("financially_risky");
    expect(evaluation.decision.recommendedPurchase).toBe(false);
  });

  it("returns not_affordable when every term exceeds the total-cost ceiling", () => {
    const assessment = assessAffordability({ ...NEED, maxMonthlyPayment: 250 }, CREDIT, LOW_CAPACITY);
    const scenarios = buildAllScenarios(30_000, 0, CREDIT.estimatedApr.min, CREDIT.estimatedApr.max, assessment.maxSustainableLoanPayment);
    const evaluation = evaluateVehicle({ ...LISTING, price: 30_000 }, scenarios, assessment);
    expect(evaluation.decision.status).toBe("not_affordable");
    expect(evaluation.decision.recommendedPurchase).toBe(false);
  });

  it("returns insufficient_data when core financial data is missing", () => {
    const assessment = assessAffordability(NEED, CREDIT, { ...CASH_FLOW, avgMonthlyIncome: 0 });
    const scenarios = buildAllScenarios(12_000, 0, CREDIT.estimatedApr.min, CREDIT.estimatedApr.max, assessment.maxSustainableLoanPayment);
    const evaluation = evaluateVehicle(LISTING, scenarios, assessment);
    expect(assessment.dataQuality).toBe("limited");
    expect(evaluation.decision.status).toBe("insufficient_data");
  });

  it("carries only user preferences and calculated limits into future search constraints", () => {
    const assessment = assessAffordability(NEED, CREDIT, CASH_FLOW);
    const constraints = buildAffordableSearchConstraints(NEED, assessment);
    expect(constraints).toMatchObject({
      zip: "43215",
      radiusMiles: 40,
      maxMileage: 100_000,
      minYear: 2018,
      vehicleTypes: ["sedan"],
      maxPrice: assessment.maxAffordableVehiclePrice,
      maxMonthlyLoanPayment: assessment.maxSustainableLoanPayment,
    });
    expect(constraints.allowedTermsMonths).toEqual([36, 48, 60, 72]);
    expect(constraints.maxPrice).not.toBe(15_000);
  });
});
