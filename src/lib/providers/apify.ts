import { runListingsActor } from "@/lib/apify/client";
import { getApifyConfig, type LiveApifyConfig } from "@/lib/apify/config";
import { ApifyError, LISTINGS_EMPTY, LISTINGS_MISSING_MAKE } from "@/lib/apify/errors";
import { guardedRun } from "@/lib/apify/guard";
import { mapListings, type MapOptions } from "@/lib/apify/mapper";
import { mockListings } from "@/lib/apify/mock";
import { buildSearchInput, MIN_PRICE } from "@/lib/apify/search";
import type { CarsComSearchInput } from "@/lib/apify/types";
import { getSearchPlanner, normalizePlan, type VehicleSearchPlan } from "@/lib/search-plan";
import type { AffordabilityResult, AffordableSearchConstraints, BuyerNeed, CarListing, CreditReport } from "@/lib/types";

export interface ListingsSearchOptions {
  /**
   * Limits from the affordability assessment, computed in code. Its `maxPrice`
   * caps the search; a live search with no room above the minimum price stops
   * before any paid run. No planner or AI output can change these.
   */
  constraints: AffordableSearchConstraints;
  /** What to search for. Defaults to the current planner's plan for `need`. */
  plan?: VehicleSearchPlan;
}

/**
 * Fails fast, before any credit pull or paid run, when a live search can't
 * start from this plan. Mock mode needs no make.
 */
export function assertSearchablePlan(plan: VehicleSearchPlan): void {
  const cfg = getApifyConfig();
  if (cfg.mode === "live" && !normalizePlan(plan).make) {
    throw new ApifyError("missing_make", LISTINGS_MISSING_MAKE, { detail: `plan source=${plan.source}` });
  }
}

/**
 * Step 3 — used-car listings near the buyer, priced to what their cash flow
 * can carry. APIFY_MODE picks a live run of the Cars.com listings Actor or
 * the demo mock explicitly; a live failure throws an ApifyError and never
 * falls back to mock listings.
 */
export async function searchLiveListings(
  need: BuyerNeed,
  affordability: AffordabilityResult,
  credit: CreditReport,
  options: ListingsSearchOptions,
): Promise<CarListing[]> {
  const cfg = getApifyConfig();
  if (cfg.mode === "mock") return mockListings(need, affordability, credit);

  const plan = normalizePlan(options.plan ?? (await getSearchPlanner()({ need })));
  const { constraints } = options;
  const input = buildSearchInput({ need, constraints, plan }, cfg);
  const filters: MapOptions = {
    minPrice: Math.max(MIN_PRICE, constraints.minPrice),
    bodyStyles: plan.bodyStyles,
    fuelTypes: plan.fuelTypes,
  };
  const key = JSON.stringify([cfg.actorId, input, filters]);
  return guardedRun(cfg, key, () => fetchListings(cfg, input, filters));
}

/**
 * One paid run, mapped. Throws rather than returning an empty list, so an
 * inconclusive result is never cached or shown as "no cars for sale".
 */
async function fetchListings(cfg: LiveApifyConfig, input: CarsComSearchInput, filters: MapOptions): Promise<CarListing[]> {
  const run = await runListingsActor(cfg, input);
  const { listings, stats } = mapListings(run.items, filters);

  // Counts only — never listing ids, VINs, seller details, or the token.
  if (run.partial || stats.mapped < stats.received) {
    console.warn(
      `[apify] run ${run.status}${run.partial ? " (partial)" : ""}: kept ${stats.mapped}/${stats.received} incomplete=${stats.incomplete} filtered=${stats.filtered} noMpg=${stats.noMpg} duplicates=${stats.duplicates}`,
    );
  }

  // A run that returns nothing looks the same whether no car matches or the
  // scraper broke (the AutoTrader Actor did exactly that), so say so honestly.
  if (stats.received === 0) {
    throw new ApifyError("empty_result", LISTINGS_EMPTY, { detail: `run ${run.status} returned 0 items` });
  }

  if (listings.length === 0) {
    const onlyFiltered = stats.filtered > 0 && stats.incomplete === 0 && stats.noMpg === 0;
    throw new ApifyError(
      "no_listings",
      onlyFiltered
        ? "We found listings near you, but none matched the body style or fuel type you asked for, or they were priced below $3,000. Try leaving the body style or fuel type out of your description."
        : "We found listings near you, but none had the price, mileage, and location details we need to compare them. Try again later or a nearby ZIP code.",
      { detail: `received=${stats.received} incomplete=${stats.incomplete} filtered=${stats.filtered} noMpg=${stats.noMpg}` },
    );
  }
  return listings;
}
