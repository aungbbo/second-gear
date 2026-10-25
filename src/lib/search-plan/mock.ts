import { CAR_CATALOG } from "@/lib/catalog";
import type { PlanBodyStyle, PlanFuelType, SearchPlanner, VehicleSearchPlan } from "@/lib/search-plan/types";

const MAKES = [
  "Acura", "Audi", "BMW", "Buick", "Cadillac", "Chevrolet", "Chrysler", "Dodge", "Ford", "GMC",
  "Honda", "Hyundai", "Infiniti", "Jeep", "Kia", "Lexus", "Lincoln", "Mazda", "Mercedes-Benz",
  "Mitsubishi", "Nissan", "Ram", "Subaru", "Tesla", "Toyota", "Volkswagen", "Volvo",
];
const MAKE_ALIASES: Record<string, string> = { chevy: "Chevrolet", vw: "Volkswagen", mercedes: "Mercedes-Benz" };

const BODY_STYLES: [RegExp, PlanBodyStyle][] = [
  [/\b(suv|crossover)s?\b/, "suv"],
  [/\b(truck|pickup)s?\b/, "truck"],
  [/\b(minivan|van)s?\b/, "van"],
  [/\bhatch(back)?s?\b/, "hatchback"],
  [/\bwagons?\b/, "wagon"],
  [/\bconvertibles?\b/, "convertible"],
  [/\bcoupes?\b/, "coupe"],
  [/\bsedans?\b/, "sedan"],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (s: string) => new RegExp(`\\b${escape(s.toLowerCase())}\\b`);

/** The single make the buyer named, if exactly one. Several makes can't be OR-ed in one search. */
export function detectMake(text: string): string | undefined {
  const found = new Set<string>();
  for (const make of MAKES) if (word(make).test(text)) found.add(make);
  for (const [alias, make] of Object.entries(MAKE_ALIASES)) if (word(alias).test(text)) found.add(make);
  return found.size === 1 ? [...found][0] : undefined;
}

/** A catalog model of that make named in the text, if exactly one. */
export function detectModel(text: string, make: string): string | undefined {
  const models = CAR_CATALOG.filter((c) => c.make === make && word(c.model).test(text)).map((c) => c.model);
  return models.length === 1 ? models[0] : undefined;
}

/** "2017 or newer", "2017+", "2017 and up". */
export function detectMinYear(text: string): number | undefined {
  const match = /\b((?:19|20)\d{2})\s*(?:\+|or newer|or later|and newer|and up)/.exec(text);
  return match ? Number(match[1]) : undefined;
}

/** "under 100,000 miles", "less than 80k mi". Only a number followed by miles, so prices never match. */
export function detectMaxMileage(text: string): number | undefined {
  const match = /\b(?:under|below|less than|max(?:imum)?|at most|no more than)\s+([\d,]+)\s*(k)?\s*(?:miles|mi)\b/.exec(text);
  if (!match) return undefined;
  const n = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return match[2] ? n * 1000 : n;
}

/**
 * Stand-in for the Bitdeer planner: reads only explicit signals from the
 * description, so a vague request yields an empty plan rather than a guess.
 */
export const mockSearchPlanner: SearchPlanner = async ({ need }) => {
  const text = need.description.toLowerCase();
  const make = detectMake(text) ?? null;
  const fuelTypes: PlanFuelType[] = /\bhybrids?\b/.test(text) ? ["hybrid"] : /\b(electric|ev)s?\b/.test(text) ? ["electric"] : [];
  const style = BODY_STYLES.find(([pattern]) => pattern.test(text));

  const plan: VehicleSearchPlan = {
    source: "mock",
    make,
    model: (make && detectModel(text, make)) ?? null,
    bodyStyles: style ? [style[1]] : [],
    fuelTypes,
    minYear: detectMinYear(text) ?? null,
    maxMileage: detectMaxMileage(text) ?? null,
    sortBy: /price\s*:\s*low to high/.test(text) ? "price_asc"
      : /price\s*:\s*high to low/.test(text) ? "price_desc"
        : /mileage\s*:\s*low to high/.test(text) ? "mileage_asc"
          : /year\s*:\s*newest first/.test(text) ? "year_desc"
            : /distance\s*:\s*nearest first/.test(text) ? "distance"
              : "deal_score",
    reason: "Search criteria follow the vehicle needs you described; results are sorted by your top priority.",
  };
  return plan;
};
