import type { BuyerNeed } from "@/lib/types";

/** Body styles the listings step can filter on after the scrape (the Cars.com Actor has no body-style input). */
export type PlanBodyStyle = "sedan" | "suv" | "truck" | "van" | "hatchback" | "wagon" | "convertible" | "coupe";

export type PlanFuelType = "hybrid" | "electric";

/**
 * What the buyer is shopping for, read from their own words. This is the
 * handoff between the planner (today the deterministic mock, later Bitdeer AI)
 * and the listings search.
 *
 * A plan narrows the search; it never sets money or location. ZIP, radius and
 * the price ceiling come from the buyer's need and the affordability
 * assessment (`AffordableSearchConstraints`), so a planner can't widen what
 * the buyer can afford. Where a plan and the buyer's search preferences both
 * set a year or mileage limit, the stricter one wins.
 */
export interface VehicleSearchPlan {
  /** Which planner produced the plan. */
  source: "mock" | "bitdeer";
  /**
   * One manufacturer as buyers write it, e.g. "Toyota". The mock sets it only
   * when the buyer names exactly one; a future Bitdeer planner may also
   * recommend one when the buyer names none (with `source: "bitdeer"`). `null`
   * makes a live search stop with `missing_make` instead of guessing; the code
   * never fills in a default such as the Actor's own BMW.
   */
  make: string | null;
  /** Model as a search keyword, e.g. "Corolla". `null` searches every model of the make. */
  model: string | null;
  /** Body styles to keep, checked against each listing after the scrape. Empty keeps all. */
  bodyStyles: PlanBodyStyle[];
  /** Fuel types to keep, checked against each listing after the scrape. Empty keeps all. */
  fuelTypes: PlanFuelType[];
  /** Oldest model year the buyer asked for, or `null`. */
  minYear: number | null;
  /** Highest mileage the buyer asked for, or `null`. */
  maxMileage: number | null;
}

export interface SearchPlanInput {
  need: BuyerNeed;
}

/**
 * Turns a buyer's need into a search plan. Implementations must not throw for
 * a vague request: they return `make: null` and let the listings step say what
 * is missing.
 */
export type SearchPlanner = (input: SearchPlanInput) => Promise<VehicleSearchPlan>;
