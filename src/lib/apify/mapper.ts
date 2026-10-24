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
  /** New-car or unrecognised listing types; the app compares used and certified pre-owned cars only. */
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

/** Listing types AutoTrader uses for used cars: plain used, manufacturer CPO, third-party certified. */
const USED_TYPES = new Set(["USED", "CERTIFIED", "3P_CERT"]);

/**
 * Used or certified pre-owned only. A missing type falls back to the title
 * prefix AutoTrader uses ("Used …", "Certified …", "New …").
 */
export function isUsedListing(listingType: string | undefined, title: string | undefined): boolean {
  if (listingType) return USED_TYPES.has(listingType.toUpperCase());
  return !/^new\b/i.test(title ?? "");
}

/** Only an https link to AutoTrader itself is passed to the browser. */
export function safeListingUrl(value: unknown): string | undefined {
  const raw = str(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !(host === "autotrader.com" || host.endsWith(".autotrader.com"))) return undefined;
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
    if (!isUsedListing(str(item.listingType), str(item.title))) {
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
    const listingUrl = safeListingUrl(item.url);
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
      ...(listingUrl ? { listingUrl } : {}),
    });
  }

  stats.mapped = listings.length;
  return { listings, stats };
}
