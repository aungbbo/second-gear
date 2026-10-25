import type { PlanBodyStyle, PlanFuelType, PlanSortBy, VehicleSearchPlan } from "@/lib/search-plan/types";

const BODY_STYLES: readonly PlanBodyStyle[] = ["sedan", "suv", "truck", "van", "hatchback", "wagon", "convertible", "coupe"];
const FUEL_TYPES: readonly PlanFuelType[] = ["hybrid", "electric"];
const SORT_OPTIONS: readonly PlanSortBy[] = ["deal_score", "price_asc", "price_desc", "mileage_asc", "year_desc", "distance"];

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() && value.trim().length <= max ? value.trim() : null;
const wholeNumber = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;

/** Keep only recognized, bounded Actor filters; model output is untrusted. */
export function normalizePlan(plan: unknown, now = new Date()): VehicleSearchPlan {
  const raw = (plan ?? {}) as Partial<Record<keyof VehicleSearchPlan, unknown>>;
  const list = <T extends string>(value: unknown, allowed: readonly T[]) =>
    Array.isArray(value) ? [...new Set(value.filter((item): item is T => allowed.includes(item as T)))] : [];
  return {
    source: raw.source === "bitdeer" ? "bitdeer" : "mock",
    make: text(raw.make, 40),
    model: text(raw.model, 60),
    bodyStyles: list(raw.bodyStyles, BODY_STYLES),
    fuelTypes: list(raw.fuelTypes, FUEL_TYPES),
    minYear: wholeNumber(raw.minYear, 1990, now.getFullYear() + 1),
    maxMileage: wholeNumber(raw.maxMileage, 1, 1_000_000),
    sortBy: SORT_OPTIONS.includes(raw.sortBy as PlanSortBy) ? raw.sortBy as PlanSortBy : "deal_score",
    reason: text(raw.reason, 240) ?? "Searching nearby listings using your vehicle preferences, with results sorted by best deal.",
  };
}
