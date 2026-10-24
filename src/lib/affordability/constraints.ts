import { LOAN_TERMS_MONTHS } from "@/lib/calculations";
import type { AffordableSearchConstraints, AffordabilityAssessment, BuyerNeed } from "@/lib/types";

/** Builds provider-neutral search limits from the assessment, never from demo data. */
export function buildAffordableSearchConstraints(
  need: BuyerNeed,
  assessment: AffordabilityAssessment,
): AffordableSearchConstraints {
  const preferences = need.searchPreferences;
  return {
    zip: need.zip,
    radiusMiles: preferences?.radiusMiles ?? null,
    minPrice: 0,
    maxPrice: assessment.maxAffordableVehiclePrice,
    maxMonthlyLoanPayment: assessment.maxSustainableLoanPayment,
    maxMonthlyVehicleCost: assessment.sustainableMonthlyVehicleCost,
    maxMileage: preferences?.maxMileage ?? null,
    minYear: preferences?.minYear ?? null,
    vehicleTypes: preferences?.vehicleTypes ?? [],
    preferredTermMonths: assessment.preferredTermMonths,
    allowedTermsMonths: [...LOAN_TERMS_MONTHS],
    assumptions: [
      "Maximum price is derived from sustainable loan payment, the application APR estimate, term, safe down payment, and estimated ownership costs.",
      "Ownership costs and APR are estimates, not lender offers or guarantees.",
      preferences?.radiusMiles === undefined ? "Radius was not supplied by the buyer." : "Radius comes from the buyer's search preferences.",
    ],
  };
}
