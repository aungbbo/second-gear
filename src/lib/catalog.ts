export interface CatalogModel {
  make: string;
  model: string;
  trims: string[];
  bodyStyle: string;
  basePriceNew: number;
  mpgCombined: number;
  reliabilityScore: number;
}

export const CAR_CATALOG: CatalogModel[] = [
  { make: "Toyota", model: "Corolla", trims: ["LE", "SE"], bodyStyle: "Sedan", basePriceNew: 23000, mpgCombined: 35, reliabilityScore: 5 },
  { make: "Toyota", model: "Camry", trims: ["LE", "SE"], bodyStyle: "Sedan", basePriceNew: 27000, mpgCombined: 32, reliabilityScore: 5 },
  { make: "Toyota", model: "Prius", trims: ["LE"], bodyStyle: "Hatchback", basePriceNew: 26000, mpgCombined: 52, reliabilityScore: 5 },
  { make: "Honda", model: "Civic", trims: ["LX", "Sport"], bodyStyle: "Sedan", basePriceNew: 24000, mpgCombined: 34, reliabilityScore: 5 },
  { make: "Honda", model: "Accord", trims: ["LX", "Sport"], bodyStyle: "Sedan", basePriceNew: 28000, mpgCombined: 32, reliabilityScore: 5 },
  { make: "Honda", model: "Fit", trims: ["LX"], bodyStyle: "Hatchback", basePriceNew: 18000, mpgCombined: 33, reliabilityScore: 4 },
  { make: "Mazda", model: "Mazda3", trims: ["Base", "Preferred"], bodyStyle: "Sedan", basePriceNew: 23000, mpgCombined: 31, reliabilityScore: 4 },
  { make: "Hyundai", model: "Elantra", trims: ["SE", "SEL"], bodyStyle: "Sedan", basePriceNew: 21000, mpgCombined: 33, reliabilityScore: 4 },
  { make: "Kia", model: "Forte", trims: ["LX", "GT-Line"], bodyStyle: "Sedan", basePriceNew: 20000, mpgCombined: 32, reliabilityScore: 4 },
  { make: "Subaru", model: "Impreza", trims: ["Base", "Premium"], bodyStyle: "Sedan", basePriceNew: 22000, mpgCombined: 30, reliabilityScore: 4 },
  { make: "Nissan", model: "Sentra", trims: ["S", "SV"], bodyStyle: "Sedan", basePriceNew: 21000, mpgCombined: 33, reliabilityScore: 3 },
  { make: "Chevrolet", model: "Cruze", trims: ["LS", "LT"], bodyStyle: "Sedan", basePriceNew: 20000, mpgCombined: 31, reliabilityScore: 3 },
  { make: "Ford", model: "Focus", trims: ["SE"], bodyStyle: "Hatchback", basePriceNew: 20000, mpgCombined: 30, reliabilityScore: 3 },
  { make: "Volkswagen", model: "Jetta", trims: ["S", "SE"], bodyStyle: "Sedan", basePriceNew: 22000, mpgCombined: 34, reliabilityScore: 3 },
];

export const DEALER_NAMES = [
  "Lakeside Auto Group",
  "Summit Motors",
  "Crossroads Pre-Owned",
  "Harbor View Autos",
  "Maple Street Motors",
  "Trailhead Auto Sales",
  "Northbound Motors",
  "Union Square Auto",
  "Pine Ridge Autos",
  "Lighthouse Motors",
];

export const CITY_STATE = [
  { city: "Columbus", state: "OH" },
  { city: "Raleigh", state: "NC" },
  { city: "Tulsa", state: "OK" },
  { city: "Fresno", state: "CA" },
  { city: "Omaha", state: "NE" },
  { city: "Richmond", state: "VA" },
  { city: "Spokane", state: "WA" },
  { city: "Akron", state: "OH" },
  { city: "Tempe", state: "AZ" },
  { city: "Knoxville", state: "TN" },
];
