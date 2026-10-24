import type { AutotraderListingItem } from "@/lib/apify/types";
import { CAR_CATALOG } from "@/lib/catalog";
import type { CarListing } from "@/lib/types";

/** Neutral score for models the catalog doesn't rate; it neither helps nor hurts ranking. */
export const UNRATED_RELIABILITY = 3;

export interface MapStats {
  received: number;
  mapped: number;
  /** Missing an id, year, make, model, price, mileage, or seller location. */
  incomplete: number;
  /** New-car listings; the app compares used cars only. */
  notUsed: number;
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

/** EPA weights combined fuel economy 55% city, 45% highway (harmonic mean). */
export function combinedMpg(city: number | undefined, highway: number | undefined): number | undefined {
  if (!city || !highway || city <= 0 || highway <= 0) return undefined;
  return Math.round(1 / (0.55 / city + 0.45 / highway));
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

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Maps the Actor's dataset to `CarListing`. A field the app can't do without
 * drops the item rather than being guessed; the counts say why.
 */
export function mapListings(items: unknown[]): { listings: CarListing[]; stats: MapStats } {
  const stats: MapStats = { received: items.length, mapped: 0, incomplete: 0, notUsed: 0, noMpg: 0, duplicates: 0 };
  const listings: CarListing[] = [];
  const seenIds = new Set<string>();
  const seenVins = new Set<string>();

  for (const raw of items) {
    const item = (raw && typeof raw === "object" ? raw : {}) as AutotraderListingItem;
    const listingId = str(item.listingId) ?? (num(item.listingId) !== undefined ? String(item.listingId) : undefined);
    const year = num(item.year);
    const make = str(item.make);
    const model = str(item.model);
    const price = num(item.salePrice);
    const mileage = num(item.mileage);
    const city = str(item.sellerCity);
    const state = str(item.sellerState);

    if (
      !listingId || !make || !model || !city || !state ||
      year === undefined || !Number.isInteger(year) || year < 1990 || year > CURRENT_YEAR + 1 ||
      price === undefined || price <= 0 ||
      mileage === undefined || mileage < 0
    ) {
      stats.incomplete++;
      continue;
    }
    if (str(item.listingType)?.toUpperCase() === "NEW") {
      stats.notUsed++;
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

    const days = num(item.daysOnSite);
    listings.push({
      id: `at_${listingId}`,
      year,
      make,
      model,
      trim: str(item.trim) ?? "",
      bodyStyle: str(item.bodyStyle) ?? catalogEntry(make, model)?.bodyStyle ?? "Vehicle",
      price: Math.round(price),
      mileage: Math.round(mileage),
      dealerName: str(item.sellerName) ?? "Private seller",
      city,
      state,
      // Unknown age counts as fresh, which keeps the walk-away margin at its most conservative.
      daysOnMarket: days !== undefined && days >= 0 ? Math.round(days) : 0,
      mpgCombined: mpg,
      reliabilityScore: reliabilityFor(make, model),
      vin,
      accentHue: hueFor(listingId),
    });
  }

  stats.mapped = listings.length;
  return { listings, stats };
}
