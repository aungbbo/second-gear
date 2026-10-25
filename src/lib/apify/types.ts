/**
 * Input and dataset item for the Cars.com listings Actor
 * (`skootle/cars-com-scraper`), taken from its input schema and the dataset
 * of test run `fW2UhtNyQQmOJGGL9` (output schema version 2026-05-09). Only
 * the fields the app sends or reads are listed.
 */

/**
 * Every field is sent on every run: the Actor fills a missing `make`,
 * `model`, `yearMin` or `yearMax` with its own defaults (BMW, "3 Series",
 * 2020, 2024), which would silently change the search.
 */
export interface CarsComSearchInput {
  make: string;
  /** Free-text keyword; empty searches every model of the make. */
  model: string;
  yearMin: number;
  yearMax: number;
  priceMax: number;
  /** `0` means no cap. */
  mileageMax: number;
  zip: string;
  searchRadius: number;
  condition: "USED";
  maxItems: number;
}

/** Every field is nullable in practice; the mapper validates each one. */
export interface CarsComListingItem {
  listingId?: unknown;
  vin?: unknown;
  listingUrl?: unknown;
  year?: unknown;
  make?: unknown;
  model?: unknown;
  trim?: unknown;
  bodyStyle?: unknown;
  fuelType?: unknown;
  /** Numeric price; `price` is the same value as a string. */
  priceUsd?: unknown;
  /** Numeric mileage; `mileage` is the same value as a string. */
  mileageMiles?: unknown;
  mpgCity?: unknown;
  mpgHighway?: unknown;
  /** Local date-time without a zone, e.g. "2026-09-17T19:03:23". */
  listedAt?: unknown;
  dealer?: {
    name?: unknown;
    city?: unknown;
    state?: unknown;
  } | null;
}
