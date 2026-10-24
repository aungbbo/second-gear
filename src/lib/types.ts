export interface BuyerNeed {
  description: string;
  maxMonthlyPayment: number;
  timeframeWeeks: number;
  downPayment: number;
  zip: string;
  ownershipCostOverrides?: OwnershipCostOverrides;
  searchPreferences?: VehicleSearchPreferences;
}

/** User-provided recurring ownership costs. Missing values remain estimates. */
export interface OwnershipCostOverrides {
  insuranceMonthly?: number;
  fuelMonthly?: number;
  maintenanceMonthly?: number;
  registrationAndTaxesMonthly?: number;
  otherMonthly?: number;
  dealerFees?: number;
}

/** Optional vehicle-search inputs preserved for the future listings provider. */
export interface VehicleSearchPreferences {
  radiusMiles?: number;
  maxMileage?: number;
  minYear?: number;
  vehicleTypes?: string[];
}

export type CreditTier =
  | "deep-subprime"
  | "subprime"
  | "nonprime"
  | "near-prime"
  | "prime";

export interface CreditFactor {
  label: string;
  impact: "positive" | "negative" | "neutral";
  detail: string;
}

export interface CreditReport {
  score: number;
  tier: CreditTier;
  tierLabel: string;
  scoreRangeLabel: string;
  factors: CreditFactor[];
  /** Application-generated APR range for the score band — an estimate, not a lender offer or approval. */
  estimatedApr: { min: number; max: number };
  /** Hard inquiries in the last 6 months, or null when the report can't tell hard from soft inquiries. */
  hardInquiriesLast6mo: number | null;
  summary: string;
}

export interface AffordabilityResult {
  avgMonthlyIncome: number;
  essentialExpenses: number;
  existingDebtPayments: number;
  discretionaryBuffer: number;
  maxSustainablePayment: number;
  recommendedPayment: number;
  savingsBalance: number;
  cashAvailableForDown: number;
  incomeVolatility: "low" | "medium" | "high";
  summary: string;
}

export interface CarListing {
  id: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  bodyStyle: string;
  price: number;
  mileage: number;
  dealerName: string;
  city: string;
  state: string;
  daysOnMarket: number;
  mpgCombined: number;
  reliabilityScore: number;
  vin: string;
  accentHue: number;
  /** Seller's listing page, when the source provides one (live listings only). */
  listingUrl?: string;
}

export interface LoanScenario {
  termMonths: number;
  apr: number;
  downPayment: number;
  amountFinanced: number;
  monthlyPayment: number;
  totalInterest: number;
  /** Total paid to the lender, excluding the down payment. */
  totalFinancingCost: number;
  totalCost: number;
  remainingBalanceAt36Months: number;
  estimatedValueAt36Months: number;
  negativeEquityAt36Months: number;
  negativeEquityMonths: number;
  withinBudget: boolean;
}

export type VehicleAffordabilityStatus =
  | "affordable"
  | "financially_risky"
  | "not_affordable"
  | "insufficient_data";

export interface FinancialRiskIndicator {
  code: string;
  severity: "low" | "medium" | "high";
  label: string;
  detail: string;
}

export interface OwnershipCostBreakdown {
  insuranceMonthly: number;
  fuelMonthly: number;
  maintenanceMonthly: number;
  registrationAndTaxesMonthly: number;
  otherMonthly: number;
  recurringMonthly: number;
  dealerFees: number;
  upfrontCashNeeded: number;
  totalMonthlyCost: number;
  estimateNotes: string[];
}

export interface VehicleAffordabilityDecision {
  status: VehicleAffordabilityStatus;
  recommendedPurchase: boolean;
  totalMonthlyCost: number;
  maxSustainableMonthlyCost: number;
  reasons: string[];
  warnings: string[];
}

export interface AffordabilityAssessment {
  statedMonthlyBudget: number;
  disposableIncomeAfterEssentialsAndDebt: number;
  emergencyReserveRequired: number;
  safeDownPayment: number;
  maxSustainableLoanPayment: number;
  sustainableMonthlyVehicleCost: number;
  maxAffordableFinancingAmount: number;
  maxAffordableVehiclePrice: number;
  preferredTermMonths: number;
  riskIndicators: FinancialRiskIndicator[];
  warnings: string[];
  assumptions: string[];
  dataQuality: "complete" | "limited";
  recommendedPurchase: boolean;
  summary: string;
}

export interface AffordableSearchConstraints {
  zip: string;
  radiusMiles: number | null;
  minPrice: number;
  maxPrice: number;
  maxMonthlyLoanPayment: number;
  maxMonthlyVehicleCost: number;
  maxMileage: number | null;
  minYear: number | null;
  vehicleTypes: string[];
  preferredTermMonths: number;
  allowedTermsMonths: number[];
  assumptions: string[];
}

export interface CarAnalysis {
  listing: CarListing;
  bestScenario: LoanScenario;
  allScenarios: LoanScenario[];
  estimatedValueAt36mo: number;
  ownershipCosts: OwnershipCostBreakdown;
  affordabilityDecision: VehicleAffordabilityDecision;
  warnings: string[];
}

export interface RankedCar extends CarAnalysis {
  rank: number;
  matchScore: number;
  headline: string;
  explanation: string;
}

export interface DealerPacketTarget {
  year: number;
  make: string;
  model: string;
  trim: string;
  walkAwayPrice: number;
  maxApr: number;
}

export interface DealerPacket {
  creditSummary: string;
  tierLabel: string;
  maxApprovedPayment: number;
  recommendedDownPayment: number;
  targets: DealerPacketTarget[];
  negotiationTips: string[];
  generatedAt: string;
}

export interface SavingsHighlight {
  amount: number;
  description: string;
}

export interface PipelineResult {
  need: BuyerNeed;
  credit: CreditReport;
  affordability: AffordabilityResult;
  affordabilityAssessment: AffordabilityAssessment;
  searchConstraints: AffordableSearchConstraints;
  listings: CarListing[];
  rankedCars: RankedCar[];
  dealerPacket: DealerPacket;
  savingsHighlight: SavingsHighlight;
}
