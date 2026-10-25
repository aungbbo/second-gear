import type { LiveApifyConfig } from "@/lib/apify/config";
import { ApifyError, LISTINGS_NO_AFFORDABLE_PRICE } from "@/lib/apify/errors";
import type { CarfaxSearchInput } from "@/lib/apify/types";
import type { AffordableSearchConstraints, BuyerNeed } from "@/lib/types";

export interface ListingsSearchContext {
  need: BuyerNeed;
  /** Legacy pipeline input; no longer mapped into the Actor request. */
  constraints?: AffordableSearchConstraints;
  /** Legacy planner input; ignored. */
  plan?: unknown;
}

/** Legacy compatibility for old search helpers; the CARFAX Actor input omits price caps. */
export const MIN_PRICE = 3000;
export function searchMaxPrice(constraints: AffordableSearchConstraints): number {
  const max = constraints.maxPrice;
  if (max === null || !Number.isFinite(max) || max <= MIN_PRICE) {
    throw new ApifyError("no_affordable_price", LISTINGS_NO_AFFORDABLE_PRICE, { detail: `maxPrice=${max ?? "none"} minPrice=${MIN_PRICE}` });
  }
  return Math.floor(max);
}

/**
 * Builds the fixed CARFAX input. ZIP is the only user-provided Actor field.
 * startUrl is deliberately omitted because it overrides zipCode and filters.
 */
export function buildSearchInput(
  { need }: ListingsSearchContext,
  _cfg: Pick<LiveApifyConfig, "maxItems">,
  _now?: Date,
): CarfaxSearchInput {
  return {
    includeDealerContact: false,
    includeHistory: true,
    includePaymentEstimate: false,
    includePriceHistory: false,
    maxItems: _cfg.maxItems,
    radius: "50",
    zipCode: need.zip,
  };
}
