import { runListingsActor } from "@/lib/apify/client";
import { getApifyConfig } from "@/lib/apify/config";
import { ApifyError } from "@/lib/apify/errors";
import { mapListings } from "@/lib/apify/mapper";
import { mockListings } from "@/lib/apify/mock";
import { buildSearchInput } from "@/lib/apify/search";
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

  const items = await runListingsActor(cfg, buildSearchInput(need, affordability, credit, cfg));
  const { listings, stats } = mapListings(items);
  // Counts only — never listing ids, VINs, seller details, or the token.
  if (stats.mapped < stats.received) {
    console.warn(
      `[apify] kept ${stats.mapped}/${stats.received}: incomplete=${stats.incomplete} notUsed=${stats.notUsed} noMpg=${stats.noMpg} duplicates=${stats.duplicates}`,
    );
  }
  if (listings.length === 0) {
    throw new ApifyError("no_listings", "We couldn't find used cars for sale near your ZIP code in your price range.", {
      detail: `received=${stats.received}`,
    });
  }
  return listings;
}
