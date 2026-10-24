import type { CarListing, OwnershipCostOverrides, OwnershipCostBreakdown } from "@/lib/types";

/** Configurable assumptions used when a buyer did not provide a cost. */
export interface OwnershipCostAssumptions {
  monthlyMiles: number;
  fuelPricePerGallon: number;
  defaultMpg: number;
  insuranceMonthly: number;
  maintenanceMonthlyFloor: number;
  maintenanceAnnualRate: number;
  registrationAndTaxesAnnualRate: number;
  otherMonthly: number;
  dealerFees: number;
}

export const DEFAULT_OWNERSHIP_COST_ASSUMPTIONS: OwnershipCostAssumptions = {
  monthlyMiles: 1_000,
  fuelPricePerGallon: 3.75,
  defaultMpg: 28,
  insuranceMonthly: 150,
  maintenanceMonthlyFloor: 65,
  maintenanceAnnualRate: 0.025,
  registrationAndTaxesAnnualRate: 0.015,
  otherMonthly: 0,
  dealerFees: 0,
};

export interface OwnershipCostInput {
  listingPrice: number;
  mpgCombined: number;
  monthlyLoanPayment: number;
  downPayment: number;
  assumptions?: Partial<OwnershipCostAssumptions>;
  overrides?: OwnershipCostOverrides;
}

const money = (value: number) => Math.max(0, Math.round(value));
const positive = (value: number | undefined) => (value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined);

/**
 * Calculates recurring ownership cost separately from the loan payment.
 * Dealer fees are kept as upfront cash so they are not silently double-counted
 * as both a financed amount and a monthly expense.
 */
export function calculateOwnershipCosts(input: OwnershipCostInput): OwnershipCostBreakdown {
  const assumptions = { ...DEFAULT_OWNERSHIP_COST_ASSUMPTIONS, ...input.assumptions };
  const overrides = input.overrides ?? {};
  const notes: string[] = [];
  const price = Math.max(0, input.listingPrice);
  const mpg = input.mpgCombined > 0 ? input.mpgCombined : assumptions.defaultMpg;

  const insuranceMonthly = positive(overrides.insuranceMonthly) ?? assumptions.insuranceMonthly;
  if (overrides.insuranceMonthly === undefined) notes.push("Insurance is an estimate based on the configured monthly assumption.");

  const fuelMonthly = positive(overrides.fuelMonthly) ?? (assumptions.monthlyMiles / mpg) * assumptions.fuelPricePerGallon;
  if (overrides.fuelMonthly === undefined) notes.push("Fuel is estimated from monthly miles, vehicle MPG, and the configured fuel price.");

  const maintenanceMonthly =
    positive(overrides.maintenanceMonthly) ??
    Math.max(assumptions.maintenanceMonthlyFloor, (price * assumptions.maintenanceAnnualRate) / 12);
  if (overrides.maintenanceMonthly === undefined) notes.push("Maintenance is an estimate using vehicle price and a configurable annual rate.");

  const registrationAndTaxesMonthly =
    positive(overrides.registrationAndTaxesMonthly) ??
    (price * assumptions.registrationAndTaxesAnnualRate) / 12;
  if (overrides.registrationAndTaxesMonthly === undefined) notes.push("Registration and taxes are estimated as a configurable share of vehicle price.");

  const otherMonthly = positive(overrides.otherMonthly) ?? assumptions.otherMonthly;
  if (overrides.otherMonthly === undefined && otherMonthly > 0) notes.push("Other recurring ownership costs use the configured estimate.");

  const dealerFees = positive(overrides.dealerFees) ?? assumptions.dealerFees;
  if (overrides.dealerFees === undefined && dealerFees > 0) notes.push("Dealer fees use the configured upfront estimate.");

  const recurringMonthly = insuranceMonthly + fuelMonthly + maintenanceMonthly + registrationAndTaxesMonthly + otherMonthly;

  return {
    insuranceMonthly: money(insuranceMonthly),
    fuelMonthly: money(fuelMonthly),
    maintenanceMonthly: money(maintenanceMonthly),
    registrationAndTaxesMonthly: money(registrationAndTaxesMonthly),
    otherMonthly: money(otherMonthly),
    recurringMonthly: money(recurringMonthly),
    dealerFees: money(dealerFees),
    upfrontCashNeeded: money(input.downPayment + dealerFees),
    totalMonthlyCost: money(input.monthlyLoanPayment + recurringMonthly),
    estimateNotes: notes,
  };
}

export function ownershipInputForListing(
  listing: CarListing,
  monthlyLoanPayment: number,
  downPayment: number,
  overrides?: OwnershipCostOverrides,
  assumptions?: Partial<OwnershipCostAssumptions>,
): OwnershipCostInput {
  return {
    listingPrice: listing.price,
    mpgCombined: listing.mpgCombined,
    monthlyLoanPayment,
    downPayment,
    overrides,
    assumptions,
  };
}
