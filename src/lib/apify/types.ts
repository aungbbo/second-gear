/** ParseForge CARFAX listings Actor (`parseforge/carfax-scraper`) input. */
export interface CarfaxSearchInput {
  includeDealerContact: false;
  includeHistory: true;
  includePaymentEstimate: false;
  includePriceHistory: false;
  maxItems: number;
  radius: "50";
  zipCode: string;
  /** @deprecated Legacy test fixture field; not sent to the CARFAX Actor. */
  searchRadius?: number;
}

/**
 * Legacy Cars.com input kept for the saved historical fixture and migration
 * tests. Live runs now use CarfaxSearchInput.
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

/** CARFAX dataset row fields consumed by this app. */
export interface CarfaxListingItem {
  carfaxId?: unknown;
  stockNumber?: unknown;
  url?: unknown;
  title?: unknown;
  listPrice?: unknown;
  currentPrice?: unknown;
  totalPrice?: unknown;
  sellerCity?: unknown;
  sellerRegion?: unknown;
  subTrim?: unknown;
  bodyStyle?: unknown;
  mpgCity?: unknown;
  mpgHighway?: unknown;
  mpgCombined?: unknown;
  dealerCity?: unknown;
  dealerState?: unknown;
  dealerZip?: unknown;
  dealerName?: unknown;
  dealerAddress?: unknown;
  dealerPhone?: unknown;
  firstSeen?: unknown;
  error?: unknown;
  accidentHistory?: unknown;
  ownerHistory?: unknown;
  serviceHistory?: unknown;
  vehicleUseHistory?: unknown;
  priceHistory?: unknown;
  vin?: unknown;
  listingUrl?: unknown;
  year?: unknown;
  make?: unknown;
  model?: unknown;
  trim?: unknown;
  bodyType?: unknown;
  fuelType?: unknown;
  price?: unknown;
  mileage?: unknown;
  oneOwner?: unknown;
  noAccidents?: unknown;
  serviceRecords?: unknown;
}
