/**
 * Input and dataset item for the AutoTrader listings Actor
 * (`caffein.dev/autotrader-com-actor`), taken from its declared input and
 * dataset schemas. Only the fields the app sends or reads are listed.
 */

export interface AutotraderSearchInput {
  zip: string;
  searchRadius: string;
  minPrice?: number;
  maxPrice: number;
  keyword?: string;
  vehicleStyleCode?: "SEDAN" | "SUVCROSS" | "TRUCKS" | "COUPE" | "CONVERT" | "HATCH" | "WAGON" | "VANMV";
  fuelTypeGroup?: "HYB" | "ELE";
  maxItems: number;
  sortBy: "relevance";
}

/** Every field is nullable in the Actor's schema; the mapper validates each one. */
export interface AutotraderListingItem {
  listingId?: unknown;
  vin?: unknown;
  url?: unknown;
  title?: unknown;
  year?: unknown;
  make?: unknown;
  model?: unknown;
  trim?: unknown;
  bodyStyle?: unknown;
  salePrice?: unknown;
  mileage?: unknown;
  mpgCity?: unknown;
  mpgHighway?: unknown;
  listingType?: unknown;
  daysOnSite?: unknown;
  sellerName?: unknown;
  sellerCity?: unknown;
  sellerState?: unknown;
}
