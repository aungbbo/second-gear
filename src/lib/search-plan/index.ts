import { mockSearchPlanner } from "@/lib/search-plan/mock";
import type { PlanBodyStyle, PlanFuelType, SearchPlanner, VehicleSearchPlan } from "@/lib/search-plan/types";

export type { PlanBodyStyle, PlanFuelType, SearchPlanInput, SearchPlanner, VehicleSearchPlan } from "@/lib/search-plan/types";

/**
 * The planner the pipeline uses. Only the mock exists today; the Bitdeer
 * planner will implement the same `SearchPlanner` signature and be returned
 * here (see docs/bitdeer-search-plan.md).
 */
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

const BODY_STYLES = Object.keys(BODY_STYLE_PATTERNS) as PlanBodyStyle[];
const FUEL_TYPES = Object.keys(FUEL_PATTERNS) as PlanFuelType[];

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);
const wholeNumber = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);

/**
 * Keeps only the plan's known fields with sane values. A planner's output,
 * an AI model's in particular, is untrusted: an unknown body style, an
 * out-of-range year, or extra fields such as a price or ZIP are dropped
 * rather than passed on. Financial limits never come from a plan.
 */
export function normalizePlan(plan: VehicleSearchPlan, now = new Date()): VehicleSearchPlan {
  const raw = (plan ?? {}) as Partial<Record<keyof VehicleSearchPlan, unknown>>;
  const list = <T extends string>(v: unknown, allowed: readonly T[]) =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is T => allowed.includes(x as T)))] : [];
  return {
    source: raw.source === "bitdeer" ? "bitdeer" : "mock",
    make: text(raw.make, 40),
    model: text(raw.model, 60),
    bodyStyles: list(raw.bodyStyles, BODY_STYLES),
    fuelTypes: list(raw.fuelTypes, FUEL_TYPES),
    minYear: wholeNumber(raw.minYear, 1990, now.getFullYear() + 1),
    maxMileage: wholeNumber(raw.maxMileage, 1, 1_000_000),
  };
}
