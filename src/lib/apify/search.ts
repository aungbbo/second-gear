import type { LiveApifyConfig } from "@/lib/apify/config";
import type { AutotraderSearchInput } from "@/lib/apify/types";
import { principalForPayment } from "@/lib/calculations";
import type { AffordabilityResult, BuyerNeed, CreditReport } from "@/lib/types";

/** Longest term the loan comparison prices (see LOAN_TERMS_MONTHS). */
const LONGEST_TERM_MONTHS = 72;
/**
 * Search a little past what the budget can carry so the true-cost pass still
 * has over-budget tradeoffs to flag, as it does with the mock listings.
 */
const PRICE_HEADROOM = 1.2;
/** Skips salvage-priced listings that would dominate a cheapest-first ranking. */
const MIN_PRICE = 3000;

const MAKES = [
  "Acura", "Audi", "BMW", "Buick", "Cadillac", "Chevrolet", "Chrysler", "Dodge", "Ford", "GMC",
  "Honda", "Hyundai", "Infiniti", "Jeep", "Kia", "Lexus", "Lincoln", "Mazda", "Mercedes-Benz",
  "Mitsubishi", "Nissan", "Ram", "Subaru", "Tesla", "Toyota", "Volkswagen", "Volvo",
];
const MAKE_ALIASES: Record<string, string> = { chevy: "Chevrolet", vw: "Volkswagen", mercedes: "Mercedes-Benz" };

/**
 * Codes from the Actor's input schema enum (latest build), which Apify
 * validates run input against: SUVCROSS "SUV / Crossover", TRUCKS "Truck",
 * VANMV "Van / Minivan". The README's table lists SUV/TRUCK/VAN/MINIVAN, which
 * the schema doesn't accept.
 */
const BODY_STYLES: [RegExp, NonNullable<AutotraderSearchInput["vehicleStyleCode"]>][] = [
  [/\b(suv|crossover)s?\b/, "SUVCROSS"],
  [/\b(truck|pickup)s?\b/, "TRUCKS"],
  [/\b(minivan|van)s?\b/, "VANMV"],
  [/\bhatch(back)?s?\b/, "HATCH"],
  [/\bwagons?\b/, "WAGON"],
  [/\bconvertibles?\b/, "CONVERT"],
  [/\bcoupes?\b/, "COUPE"],
  [/\bsedans?\b/, "SEDAN"],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The single make the buyer named, if exactly one. Several makes can't be OR-ed in one search. */
export function detectMake(text: string): string | undefined {
  const found = new Set<string>();
  for (const make of MAKES) if (new RegExp(`\\b${escape(make.toLowerCase())}\\b`).test(text)) found.add(make);
  for (const [alias, make] of Object.entries(MAKE_ALIASES)) if (new RegExp(`\\b${alias}\\b`).test(text)) found.add(make);
  return found.size === 1 ? [...found][0] : undefined;
}

/** Highest price worth searching: what the safe payment carries at the best estimated APR over the longest term. */
export function priceCeiling(need: BuyerNeed, affordability: AffordabilityResult, credit: CreditReport): number {
  const financeable = principalForPayment(affordability.maxSustainablePayment, credit.estimatedApr.min, LONGEST_TERM_MONTHS);
  return Math.max(MIN_PRICE + 1000, Math.round((financeable * PRICE_HEADROOM + need.downPayment) / 500) * 500);
}

/**
 * Turns the buyer's need into the Actor's structured search. Only explicit
 * signals are used (a named make, a body style, hybrid/electric); the free
 * text itself is never sent, so a vague description can't zero out results.
 */
export function buildSearchInput(
  need: BuyerNeed,
  affordability: AffordabilityResult,
  credit: CreditReport,
  cfg: Pick<LiveApifyConfig, "searchRadius" | "maxItems">,
): AutotraderSearchInput {
  const text = need.description.toLowerCase();
  const input: AutotraderSearchInput = {
    zip: need.zip,
    searchRadius: cfg.searchRadius,
    minPrice: MIN_PRICE,
    maxPrice: priceCeiling(need, affordability, credit),
    maxItems: cfg.maxItems,
    sortBy: "relevance",
  };

  const make = detectMake(text);
  if (make) input.keyword = make;

  const style = BODY_STYLES.find(([pattern]) => pattern.test(text));
  if (style) input.vehicleStyleCode = style[1];

  // Schema codes: HYB "Hybrid", ELE "Electric" (the README's ELC isn't in the enum).
  if (/\bhybrids?\b/.test(text)) input.fuelTypeGroup = "HYB";
  else if (/\b(electric|ev)s?\b/.test(text)) input.fuelTypeGroup = "ELE";

  // `listingType` stays unset: it takes one value, and USED alone may leave out
  // certified pre-owned cars (CERTIFIED, 3P_CERT). New cars are dropped by the mapper.
  return input;
}
