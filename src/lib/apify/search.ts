import type { LiveApifyConfig } from "@/lib/apify/config";
import { ApifyError, LISTINGS_MISSING_MAKE, LISTINGS_NO_AFFORDABLE_PRICE } from "@/lib/apify/errors";
import type { CarsComSearchInput } from "@/lib/apify/types";
import { normalizePlan, type VehicleSearchPlan } from "@/lib/search-plan";
import type { AffordableSearchConstraints, BuyerNeed } from "@/lib/types";

/** Skips salvage-priced listings that would dominate a cheapest-first ranking. The Actor has no minimum price, so the mapper applies it. */
export const MIN_PRICE = 3000;
/** Oldest model year the mapper accepts; sent so the Actor's own default (2020) never applies. */
const EARLIEST_YEAR = 1990;

/**
 * The assessment's maximum affordable vehicle price, which already accounts
 * for ownership costs, the emergency reserve and dealer fees. It is computed
 * in code from the buyer's own numbers; no planner or AI output can raise it.
 * Throws `no_affordable_price`, so no paid run starts, when it leaves nothing
 * above the minimum search price.
 */
export function searchMaxPrice(constraints: AffordableSearchConstraints): number {
  const max = constraints.maxPrice;
  if (!Number.isFinite(max) || max <= MIN_PRICE) {
    throw new ApifyError("no_affordable_price", LISTINGS_NO_AFFORDABLE_PRICE, { detail: `maxPrice=${Math.round(max)} minPrice=${MIN_PRICE}` });
  }
  return Math.floor(max);
}

const stricterMin = (...values: (number | null | undefined)[]) => {
  const set = values.filter((v): v is number => typeof v === "number");
  return set.length ? Math.max(...set) : undefined;
};
const stricterMax = (...values: (number | null | undefined)[]) => {
  const set = values.filter((v): v is number => typeof v === "number" && v > 0);
  return set.length ? Math.min(...set) : undefined;
};

export interface ListingsSearchContext {
  need: BuyerNeed;
  constraints: AffordableSearchConstraints;
  plan: VehicleSearchPlan;
}

/**
 * Turns the search plan and affordability limits into the Actor's input.
 * Money and location come only from the need and the constraints; the plan
 * can only narrow the vehicle. Throws before any paid run when the plan names
 * no make (the Actor requires one, and its default would search BMWs) or the
 * buyer can't afford a car above the minimum search price.
 */
export function buildSearchInput(
  { need, constraints, plan: rawPlan }: ListingsSearchContext,
  cfg: Pick<LiveApifyConfig, "searchRadius" | "maxItems">,
  now = new Date(),
): CarsComSearchInput {
  const plan = normalizePlan(rawPlan);
  const make = plan.make;
  if (!make) throw new ApifyError("missing_make", LISTINGS_MISSING_MAKE, { detail: `plan source=${plan.source}` });

  return {
    make,
    model: plan.model ?? "",
    yearMin: stricterMin(plan.minYear, constraints.minYear) ?? EARLIEST_YEAR,
    yearMax: now.getFullYear() + 1,
    priceMax: searchMaxPrice(constraints),
    mileageMax: stricterMax(plan.maxMileage, constraints.maxMileage) ?? 0,
    zip: need.zip,
    searchRadius: constraints.radiusMiles ?? Number(cfg.searchRadius),
    condition: "USED",
    maxItems: cfg.maxItems,
  };
}
