import { buildAllScenarios, depreciatedValue, pickBestScenario } from "@/lib/calculations";
import type { AffordabilityResult, BuyerNeed, CarAnalysis, CarListing, CreditReport } from "@/lib/types";

/**
 * Step 4 — true-cost loan comparison. Plain code, no external call: takes
 * the live listings plus the credit and cash-flow reads and works out what
 * every car actually costs across loan terms.
 */
export function analyzeCars(
  listings: CarListing[],
  affordability: AffordabilityResult,
  credit: CreditReport,
  need: BuyerNeed,
): CarAnalysis[] {
  return listings.map((listing) => {
    const downPayment = Math.min(need.downPayment, listing.price);
    const allScenarios = buildAllScenarios(
      listing.price,
      downPayment,
      credit.estimatedApr.min,
      credit.estimatedApr.max,
      affordability.maxSustainablePayment,
    );
    const bestScenario = pickBestScenario(allScenarios);
    const estimatedValueAt36mo = Math.round(depreciatedValue(listing.price, 36));

    const warnings: string[] = [];

    if (!bestScenario.withinBudget) {
      const over = bestScenario.monthlyPayment - affordability.maxSustainablePayment;
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

    return {
      listing,
      bestScenario,
      allScenarios,
      estimatedValueAt36mo,
      warnings,
    };
  });
}
