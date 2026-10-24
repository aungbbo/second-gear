import { runListingsActor } from "@/lib/apify/client";
import { getApifyConfig, type LiveApifyConfig } from "@/lib/apify/config";
import { ApifyError } from "@/lib/apify/errors";
import { guardedRun } from "@/lib/apify/guard";
import { mapListings } from "@/lib/apify/mapper";
import { mockListings } from "@/lib/apify/mock";
import { buildSearchInput } from "@/lib/apify/search";
import type { AutotraderSearchInput } from "@/lib/apify/types";
import type { AffordabilityResult, BuyerNeed, CarListing, CreditReport } from "@/lib/types";

/**
 * Step 3 — used-car listings near the buyer, priced to what their cash flow
 * can carry. APIFY_MODE picks a live run of the AutoTrader listings Actor or
 * the demo mock explicitly; a live failure throws an ApifyError and never
 * falls back to mock listings.
 */
export async function searchLiveListings(
  need: BuyerNeed,
  affordability: AffordabilityResult,
  credit: CreditReport,
): Promise<CarListing[]> {
  const cfg = getApifyConfig();
  if (cfg.mode === "mock") return mockListings(need, affordability, credit);

  const input = buildSearchInput(need, affordability, credit, cfg);
  const key = JSON.stringify([cfg.actorId, input]);
  const listings = await guardedRun(cfg, key, () => fetchListings(cfg, input));

  if (listings.length === 0) {
    throw new ApifyError(
      "no_listings",
      `We couldn't find used cars for sale within ${cfg.searchRadius} miles of ${need.zip} in your price range. Try a nearby ZIP code or a different budget.`,
    );
  }
  return listings;
}

/** One paid run, mapped. Returns [] when nothing usable came back, so the empty result is cached too. */
async function fetchListings(cfg: LiveApifyConfig, input: AutotraderSearchInput): Promise<CarListing[]> {
  const run = await runListingsActor(cfg, input);
  const { listings, stats } = mapListings(run.items);

  // Counts only — never listing ids, VINs, seller details, or the token.
  if (run.partial || stats.mapped < stats.received) {
    console.warn(
      `[apify] run ${run.status}${run.partial ? " (partial)" : ""}: kept ${stats.mapped}/${stats.received} incomplete=${stats.incomplete} notUsed=${stats.notUsed} noMpg=${stats.noMpg} duplicates=${stats.duplicates}`,
    );
  }

  if (listings.length === 0 && stats.received > 0) {
    throw new ApifyError(
      "no_listings",
      "We found listings near you, but none had the price, mileage, and location details we need to compare them. Try again later or a nearby ZIP code.",
      { detail: `received=${stats.received} incomplete=${stats.incomplete} notUsed=${stats.notUsed} noMpg=${stats.noMpg}` },
    );
  }
  return listings;
}
