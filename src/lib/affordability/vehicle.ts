import type {
  AffordabilityAssessment,
  CarListing,
  LoanScenario,
  OwnershipCostOverrides,
  OwnershipCostBreakdown,
  VehicleAffordabilityDecision,
} from "@/lib/types";
import {
  calculateOwnershipCosts,
  ownershipInputForListing,
  type OwnershipCostAssumptions,
} from "@/lib/affordability/ownership";

export interface VehicleEvaluation {
  scenario: LoanScenario;
  ownershipCosts: OwnershipCostBreakdown;
  decision: VehicleAffordabilityDecision;
}

function riskWarnings(assessment: AffordabilityAssessment, scenario: LoanScenario): string[] {
  const warnings: string[] = [];
  if (scenario.termMonths >= 72) warnings.push("This option needs the longest available term, leaving less room for repairs or income changes.");
  if (scenario.negativeEquityMonths >= 24) warnings.push(`The loan balance is above the estimated vehicle value for roughly ${scenario.negativeEquityMonths} months.`);
  if (scenario.negativeEquityAt36Months > 0) warnings.push(`After 36 months, the estimated negative-equity exposure is about $${scenario.negativeEquityAt36Months.toLocaleString()}.`);
  if (assessment.riskIndicators.some((indicator) => indicator.severity === "high")) warnings.push("The buyer's broader financial profile has at least one high-severity risk indicator.");
  return warnings;
}

function decisionFor(
  scenario: LoanScenario,
  ownershipCosts: OwnershipCostBreakdown,
  assessment: AffordabilityAssessment,
): VehicleAffordabilityDecision {
  const warnings = riskWarnings(assessment, scenario);
  const reasons: string[] = [];
  if (ownershipCosts.totalMonthlyCost > assessment.statedMonthlyBudget + 0.5) {
    reasons.push(`Estimated monthly car cost is $${ownershipCosts.totalMonthlyCost}, above your $${assessment.statedMonthlyBudget} monthly target.`);
  }
  if (!scenario.withinBudget) reasons.push(`The estimated loan payment is $${scenario.monthlyPayment}, above your $${assessment.statedMonthlyBudget} monthly target, before ongoing ownership costs.`);
  if (scenario.termMonths >= 72) reasons.push("The payment only works on a 72-month term.");
  if (scenario.negativeEquityMonths >= 24) reasons.push("Depreciation creates extended negative-equity exposure.");

  if (assessment.dataQuality === "limited") {
    return {
      status: "insufficient_data",
      recommendedPurchase: false,
      totalMonthlyCost: ownershipCosts.totalMonthlyCost,
      maxSustainableMonthlyCost: assessment.statedMonthlyBudget,
      reasons: ["A safe vehicle decision requires complete income, debt, savings, and credit inputs."],
      warnings,
    };
  }

  const paymentFits = scenario.withinBudget && ownershipCosts.totalMonthlyCost <= assessment.statedMonthlyBudget + 0.5;
  if (!paymentFits) {
    return {
      status: "not_affordable",
      recommendedPurchase: false,
      totalMonthlyCost: ownershipCosts.totalMonthlyCost,
      maxSustainableMonthlyCost: assessment.statedMonthlyBudget,
      reasons: reasons.length > 0 ? reasons : ["No available financing term fits the sustainable monthly cost."],
      warnings,
    };
  }

  const risky = warnings.length > 0 || scenario.totalInterest > scenario.amountFinanced * 0.6;
  return {
    status: risky ? "financially_risky" : "affordable",
    recommendedPurchase: !risky,
    totalMonthlyCost: ownershipCosts.totalMonthlyCost,
    maxSustainableMonthlyCost: assessment.statedMonthlyBudget,
    reasons: risky ? ["The payment fits your monthly target, but the term, interest, depreciation, or broader financial risks warrant caution."] : ["Loan payment and estimated recurring ownership costs fit your monthly target."],
    warnings,
  };
}

/** Evaluates every loan scenario with ownership costs before a recommendation is ranked. */
export function evaluateVehicle(
  listing: CarListing,
  scenarios: LoanScenario[],
  assessment: AffordabilityAssessment,
  overrides?: OwnershipCostOverrides,
  assumptions?: Partial<OwnershipCostAssumptions>,
): VehicleEvaluation {
  const evaluated = scenarios.map((scenario) => {
    const ownershipCosts = calculateOwnershipCosts(
      ownershipInputForListing(listing, scenario.monthlyPayment, scenario.downPayment, overrides, assumptions),
    );
    return { scenario, ownershipCosts, decision: decisionFor(scenario, ownershipCosts, assessment) };
  });
  const safe = evaluated.filter((candidate) => candidate.decision.status === "affordable");
  const cautious = evaluated.filter((candidate) => candidate.decision.status === "financially_risky");
  const pool = safe.length > 0 ? safe : cautious.length > 0 ? cautious : evaluated;
  return [...pool].sort((a, b) => a.scenario.totalInterest - b.scenario.totalInterest || a.ownershipCosts.totalMonthlyCost - b.ownershipCosts.totalMonthlyCost)[0];
}
