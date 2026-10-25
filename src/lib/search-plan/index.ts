import { mockSearchPlanner } from "@/lib/search-plan/mock";
import type { PlanBodyStyle, PlanFuelType, SearchPlanner } from "@/lib/search-plan/types";

export type { PlanBodyStyle, PlanFuelType, PlanSortBy, SearchPlanInput, SearchPlanner, VehicleSearchPlan } from "@/lib/search-plan/types";
export { normalizePlan } from "@/lib/search-plan/normalize";

/** Legacy compatibility for older callers; the live pipeline no longer plans searches with an AI call. */
export function getSearchPlanner(): SearchPlanner {
  return mockSearchPlanner;
}

const BODY_STYLE_PATTERNS: Record<PlanBodyStyle, RegExp> = {
  sedan: /\bsedan\b/i,
  suv: /\b(suv|crossover|sport utility)\b/i,
  truck: /\b(truck|pickup)\b/i,
  van: /\b(van|minivan)\b/i,
  hatchback: /\bhatch(back)?\b/i,
  wagon: /\bwagon\b/i,
  convertible: /\bconvertible\b/i,
  coupe: /\bcoupe\b/i,
};

const FUEL_PATTERNS: Record<PlanFuelType, RegExp> = {
  hybrid: /\bhybrid\b/i,
  electric: /\belectric\b/i,
};

/** True when the plan sets no body style, or the listing's matches one of them. */
export function matchesBodyStyle(bodyStyle: string | undefined, wanted: readonly PlanBodyStyle[]): boolean {
  return wanted.length === 0 || (!!bodyStyle && wanted.some((s) => BODY_STYLE_PATTERNS[s].test(bodyStyle)));
}

/** True when the plan sets no fuel type, or the listing's matches one of them. A listing with no fuel type doesn't match. */
export function matchesFuelType(fuelType: string | undefined, wanted: readonly PlanFuelType[]): boolean {
  return wanted.length === 0 || (!!fuelType && wanted.some((f) => FUEL_PATTERNS[f].test(fuelType)));
}
