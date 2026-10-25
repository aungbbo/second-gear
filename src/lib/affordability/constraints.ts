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
    maxPrice: null,
    maxMileage: preferences?.maxMileage ?? null,
    minYear: preferences?.minYear ?? null,
    vehicleTypes: preferences?.vehicleTypes ?? [],
    assumptions: [
      "No vehicle price cap is inferred because no loan APR or term was supplied.",
      "The monthly limit is a cash-flow estimate, not a lender offer or guarantee.",
      preferences?.radiusMiles === undefined ? "Radius was not supplied by the buyer." : "Radius comes from the buyer's search preferences.",
    ],
  };
}
