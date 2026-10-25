import { buildAllScenarios, depreciatedValue } from "@/lib/calculations";
import { evaluateVehicle } from "@/lib/affordability/vehicle";
import type {
  AffordabilityAssessment,
  AffordabilityResult,
  BuyerNeed,
  CarAnalysis,
  CarListing,
  CreditReport,
} from "@/lib/types";

/**
 * Step 4 — true-cost loan comparison. Plain code, no external call: takes
 * the live listings plus the credit and cash-flow reads and works out what
 * every car actually costs across loan terms.
 */
export function analyzeCars(
  listings: CarListing[],
  _affordability: AffordabilityResult,
  credit: CreditReport,
  need: BuyerNeed,
  assessment: AffordabilityAssessment,
): CarAnalysis[] {
  return listings.map((listing) => {
    const downPayment = Math.min(need.downPayment, assessment.safeDownPayment, listing.price);
    const allScenarios = buildAllScenarios(
      listing.price,
      downPayment,
      credit.estimatedApr.min,
      credit.estimatedApr.max,
      assessment.statedMonthlyBudget,
    );
    const evaluation = evaluateVehicle(
      listing,
      allScenarios,
      assessment,
      need.ownershipCostOverrides,
    );
    const bestScenario = evaluation.scenario;
    const estimatedValueAt36mo = bestScenario.estimatedValueAt36Months || Math.round(depreciatedValue(listing.price, 36));

    return {
      listing,
      bestScenario,
      allScenarios,
      estimatedValueAt36mo,
      ownershipCosts: evaluation.ownershipCosts,
      affordabilityDecision: evaluation.decision,
      warnings: buildVehicleWarnings(listing, bestScenario, assessment, evaluation.decision),
    };
  });
}

/** Re-evaluate loan-term fit after the ranking model supplies vehicle-cost estimates. */
export function applyOwnershipCostEstimates(
  analysis: CarAnalysis,
  overrides: BuyerNeed["ownershipCostOverrides"],
  assessment: AffordabilityAssessment,
): CarAnalysis {
  const evaluation = evaluateVehicle(analysis.listing, analysis.allScenarios, assessment, overrides);
  return {
    ...analysis,
    bestScenario: evaluation.scenario,
    ownershipCosts: evaluation.ownershipCosts,
    affordabilityDecision: evaluation.decision,
    warnings: buildVehicleWarnings(analysis.listing, evaluation.scenario, assessment, evaluation.decision),
  };
}

function buildVehicleWarnings(
  listing: CarListing,
  scenario: CarAnalysis["bestScenario"],
  assessment: AffordabilityAssessment,
  decision: CarAnalysis["affordabilityDecision"],
): string[] {
  const warnings: string[] = [];

  if (!scenario.withinBudget) {
    const over = scenario.monthlyPayment - assessment.statedMonthlyBudget;
    warnings.push(`Even stretched to ${scenario.termMonths} months, the payment runs $${over}/mo over your monthly target.`);
  }
  if (scenario.negativeEquityMonths >= 30) {
    warnings.push(`You'd owe more than the car is worth for roughly ${scenario.negativeEquityMonths} months — risky if you need to sell or trade in early.`);
  }
  if (scenario.totalInterest > listing.price * 0.35) {
    warnings.push(`Interest alone adds $${scenario.totalInterest.toLocaleString()} — more than a third of the car's price.`);
  }
  if (scenario.termMonths >= 72) {
    warnings.push("Only fits your budget on a 72-month term — a long time to owe on a depreciating car.");
  }
  if (listing.mileage > 105000) {
    warnings.push(`${listing.mileage.toLocaleString()} miles already on it — budget for maintenance sooner.`);
  }
  if (listing.carfaxHistory?.noAccidents === false || (listing.carfaxHistory?.noAccidents !== true && listing.carfaxHistory?.accidentNotes?.length)) {
    const detail = listing.carfaxHistory.accidentNotes?.[0];
    warnings.push(detail ? `CARFAX history: ${detail}` : "CARFAX reports accident history for this vehicle.");
  }
  if (listing.carfaxHistory?.oneOwner === false) warnings.push("CARFAX reports more than one previous owner.");

  warnings.push(...decision.reasons, ...decision.warnings);
  return [...new Set(warnings)];
}
