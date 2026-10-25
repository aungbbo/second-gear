import type { AffordabilityResult, BuyerNeed, CreditReport } from "@/lib/types";

/** Body styles the listings step filters after the scrape (CarGurus Actor has no body-style input). */
export type PlanBodyStyle = "sedan" | "suv" | "truck" | "van" | "hatchback" | "wagon" | "convertible" | "coupe";

export type PlanFuelType = "hybrid" | "electric";
export type PlanSortBy = "deal_score" | "price_asc" | "price_desc" | "mileage_asc" | "year_desc" | "distance";

/**
 * Search intent selected by Bitdeer from the buyer's stated need and
 * high-level financial context. This is the handoff to the listings search.
 *
 * A plan narrows the search; it never sets money or location. ZIP, radius and
 * the price ceiling come from the buyer's need and the affordability
 * assessment. No price ceiling is inferred without a loan APR and term. ZIP,
 * radius, result count, and proxy configuration remain app-controlled. Where
 * a plan and buyer preferences both set year or mileage, the stricter wins.
 */
export interface VehicleSearchPlan {
  /** Which planner produced the plan. */
  source: "mock" | "bitdeer";
  /**
   * Optional single manufacturer, either requested by the buyer or recommended
   * by Bitdeer. `null` leaves the search broad; the Actor's defaults are not used.
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
  /** Actor-supported sort order matching the buyer's selected priority. */
  /** Optional only for legacy saved search plans; normalization supplies a default. */
  sortBy?: PlanSortBy;
  /** Brief user-facing summary of the selected search criteria. */
  reason?: string;
}

export interface SearchPlanInput {
  need: BuyerNeed;
  credit?: CreditReport;
  affordability?: AffordabilityResult;
}

/**
 * Turns a buyer's need and financial context into a search plan. Implementors
 * should return broad safe defaults when the request is vague.
 */
export type SearchPlanner = (input: SearchPlanInput) => Promise<VehicleSearchPlan>;
