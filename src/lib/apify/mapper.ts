import type { CarsComListingItem } from "@/lib/apify/types";
import { CAR_CATALOG } from "@/lib/catalog";
import { matchesBodyStyle, matchesFuelType, type PlanBodyStyle, type PlanFuelType } from "@/lib/search-plan";
import type { CarListing } from "@/lib/types";

/** Neutral score for models the catalog doesn't rate; it neither helps nor hurts ranking. */
export const UNRATED_RELIABILITY = 3;

export interface MapStats {
  received: number;
  mapped: number;
  /** Missing an id, year, make, model, price, mileage, or seller location. */
  incomplete: number;
  /** Below the minimum price, or not the body style or fuel type the plan asked for. */
  filtered: number;
  /** No MPG from the listing or the catalog, so it can't be ranked honestly. */
  noMpg: number;
  duplicates: number;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function catalogEntry(make: string, model: string) {
  return CAR_CATALOG.find((c) => norm(c.make) === norm(make) && norm(c.model) === norm(model));
}

/**
 * EPA weights combined fuel economy 55% city, 45% highway (harmonic mean).
 * With only one figure listed, the city figure stands in (the lower, more
 * conservative one); a highway-only figure is too optimistic to use.
 */
export function combinedMpg(city: number | undefined, highway: number | undefined): number | undefined {
  const c = city !== undefined && city > 0 ? city : undefined;
  const h = highway !== undefined && highway > 0 ? highway : undefined;
  if (c && h) return Math.round(1 / (0.55 / c + 0.45 / h));
  return c ? Math.round(c) : undefined;
}

const LISTING_HOSTS = ["cars.com"];

/** Only an https link to Cars.com itself is passed to the browser. */
export function safeListingUrl(value: unknown): string | undefined {
  const raw = str(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !LISTING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return undefined;
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Catalog score for the model, else the make's average, else neutral. */
export function reliabilityFor(make: string, model: string): number {
  const exact = catalogEntry(make, model);
  if (exact) return exact.reliabilityScore;
  const sameMake = CAR_CATALOG.filter((c) => norm(c.make) === norm(make));
  if (sameMake.length === 0) return UNRATED_RELIABILITY;
  return Math.round(sameMake.reduce((sum, c) => sum + c.reliabilityScore, 0) / sameMake.length);
}

/** Stable, cosmetic swatch hue derived from the listing id. */
export function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since `listedAt`; undefined when missing, unparsable, or in the future. */
export function daysSince(listedAt: string | undefined, now: number): number | undefined {
  if (!listedAt) return undefined;
  const at = Date.parse(listedAt);
  if (!Number.isFinite(at) || at > now) return undefined;
  return Math.floor((now - at) / DAY_MS);
}

export interface MapOptions {
  /** Drops listings priced below this. */
  minPrice?: number;
  bodyStyles?: readonly PlanBodyStyle[];
  fuelTypes?: readonly PlanFuelType[];
  /** Clock for `daysOnMarket`; tests pin it. */
  now?: number;
}

/**
 * Maps the Actor's dataset to `CarListing`. A field the app can't do without
 * drops the item rather than being guessed; the counts say why.
 */
export function mapListings(items: unknown[], options: MapOptions = {}): { listings: CarListing[]; stats: MapStats } {
  const now = options.now ?? Date.now();
  const currentYear = new Date(now).getFullYear();
  const stats: MapStats = { received: items.length, mapped: 0, incomplete: 0, filtered: 0, noMpg: 0, duplicates: 0 };
  const listings: CarListing[] = [];
  const seenIds = new Set<string>();
  const seenVins = new Set<string>();

  for (const raw of items) {
    const item = (raw && typeof raw === "object" ? raw : {}) as CarsComListingItem;
    const dealer: NonNullable<CarsComListingItem["dealer"]> = item.dealer && typeof item.dealer === "object" ? item.dealer : {};
    const listingId = str(item.listingId) ?? (num(item.listingId) !== undefined ? String(item.listingId) : undefined);
    const year = num(item.year);
    const make = str(item.make);
    const model = str(item.model);
    const price = num(item.priceUsd);
    const mileage = num(item.mileageMiles);
    const city = str(dealer.city);
    const state = str(dealer.state);

    if (
      !listingId || !make || !model || !city || !state ||
      year === undefined || !Number.isInteger(year) || year < 1990 || year > currentYear + 1 ||
      price === undefined || price <= 0 ||
      mileage === undefined || mileage < 0
    ) {
      stats.incomplete++;
      continue;
    }
    const bodyStyle = str(item.bodyStyle) ?? catalogEntry(make, model)?.bodyStyle;
    if (
      price < (options.minPrice ?? 0) ||
      !matchesBodyStyle(bodyStyle, options.bodyStyles ?? []) ||
      !matchesFuelType(str(item.fuelType), options.fuelTypes ?? [])
    ) {
      stats.filtered++;
      continue;
    }

    const mpg = combinedMpg(num(item.mpgCity), num(item.mpgHighway)) ?? catalogEntry(make, model)?.mpgCombined;
    if (mpg === undefined) {
      stats.noMpg++;
      continue;
    }

    const vin = str(item.vin)?.toUpperCase() ?? "";
    if (seenIds.has(listingId) || (vin && seenVins.has(vin))) {
      stats.duplicates++;
      continue;
    }
    seenIds.add(listingId);
    if (vin) seenVins.add(vin);

    const days = daysSince(str(item.listedAt), now);
    const listingUrl = safeListingUrl(item.listingUrl);
    listings.push({
      id: `cc_${listingId}`,
      year,
      make,
      model,
      trim: str(item.trim) ?? "",
      bodyStyle: bodyStyle ?? "Vehicle",
      price: Math.round(price),
      mileage: Math.round(mileage),
      dealerName: str(dealer.name) ?? "Private seller",
      city,
      state,
      // Unknown age counts as fresh, which keeps the walk-away margin at its most conservative.
      daysOnMarket: days ?? 0,
      mpgCombined: mpg,
      reliabilityScore: reliabilityFor(make, model),
      vin,
      accentHue: hueFor(listingId),
      ...(listingUrl ? { listingUrl } : {}),
    });
  }

  stats.mapped = listings.length;
  return { listings, stats };
}
