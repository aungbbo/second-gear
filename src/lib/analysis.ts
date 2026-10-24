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
      assessment.maxSustainableLoanPayment,
    );
    const evaluation = evaluateVehicle(
      listing,
      allScenarios,
      assessment,
      need.ownershipCostOverrides,
    );
    const bestScenario = evaluation.scenario;
    const estimatedValueAt36mo = bestScenario.estimatedValueAt36Months || Math.round(depreciatedValue(listing.price, 36));

    const warnings: string[] = [];

    if (!bestScenario.withinBudget) {
      const over = bestScenario.monthlyPayment - assessment.maxSustainableLoanPayment;
      warnings.push(
        `Even stretched to ${bestScenario.termMonths} months, the payment runs $${over}/mo over your safe budget.`,
      );
    }

    if (bestScenario.negativeEquityMonths >= 30) {
      warnings.push(
        `You'd owe more than the car is worth for roughly ${bestScenario.negativeEquityMonths} months — risky if you need to sell or trade in early.`,
      );
    }

    if (bestScenario.totalInterest > listing.price * 0.35) {
      warnings.push(
        `Interest alone adds $${bestScenario.totalInterest.toLocaleString()} — more than a third of the car's price.`,
      );
    }

    if (bestScenario.termMonths >= 72) {
      warnings.push("Only fits your budget on a 72-month term — a long time to owe on a depreciating car.");
    }

    if (listing.mileage > 105000) {
      warnings.push(`${listing.mileage.toLocaleString()} miles already on it — budget for maintenance sooner.`);
    }

    warnings.push(...evaluation.decision.reasons, ...evaluation.decision.warnings);

    return {
      listing,
      bestScenario,
      allScenarios,
      estimatedValueAt36mo,
      ownershipCosts: evaluation.ownershipCosts,
      affordabilityDecision: evaluation.decision,
      warnings: [...new Set(warnings)],
    };
  });
}
