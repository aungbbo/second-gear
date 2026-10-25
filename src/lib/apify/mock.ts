import { CAR_CATALOG, CITY_STATE, DEALER_NAMES } from "@/lib/catalog";
import { SeededRandom } from "@/lib/random";
import type { AffordabilityResult, BuyerNeed, CarListing, CreditReport } from "@/lib/types";

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Demo listings for APIFY_MODE=mock: seeded from the buyer's ZIP and
 * description so a given search always returns the same cars.
 */
export async function mockListings(
  need: BuyerNeed,
  _affordability: AffordabilityResult,
  _credit: CreditReport,
): Promise<CarListing[]> {
  await simulateLatency(700, 1100);

  const rand = new SeededRandom(`apify:${need.zip}:${need.description}`);
  const count = rand.int(9, 12);
  const listings: CarListing[] = [];

  for (let i = 0; i < count; i++) {
    const catalogEntry = rand.pick(CAR_CATALOG);
    const trim = rand.pick(catalogEntry.trims);
    const dealer = rand.pick(DEALER_NAMES);
    const location = rand.pick(CITY_STATE);

    // Generate used-car prices independently of the buyer's monthly ceiling;
    // affordability is assessed against each listing downstream.
    const spread = rand.between(0.55, 0.9);
    const age = rand.int(1, 8);
    const basePrice = catalogEntry.basePriceNew * Math.pow(0.86, age);
    const price = Math.round((basePrice * spread) / 50) * 50;

    const avgMiles = age * rand.between(9000, 14000);

    listings.push({
      id: `lst_${i}_${Math.round(rand.next() * 1e6)}`,
      year: CURRENT_YEAR - age,
      make: catalogEntry.make,
      model: catalogEntry.model,
      trim,
      bodyStyle: catalogEntry.bodyStyle,
      price: Math.max(5500, price),
      mileage: Math.round(avgMiles / 500) * 500,
      dealerName: dealer,
      city: location.city,
      state: location.state,
      daysOnMarket: rand.int(2, 46),
      mpgCombined: catalogEntry.mpgCombined,
      reliabilityScore: catalogEntry.reliabilityScore,
      vin: generateVin(rand),
      accentHue: rand.int(0, 360),
    });
  }

  return dedupeByModel(listings);
}

function dedupeByModel(listings: CarListing[]): CarListing[] {
  const seen = new Set<string>();
  const result: CarListing[] = [];
  for (const listing of listings) {
    const key = `${listing.make}-${listing.model}-${listing.year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(listing);
  }
  return result;
}

function generateVin(rand: SeededRandom): string {
  const chars = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
  let vin = "";
  for (let i = 0; i < 17; i++) vin += chars[rand.int(0, chars.length - 1)];
  return vin;
}

function simulateLatency(minMs: number, maxMs: number) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
