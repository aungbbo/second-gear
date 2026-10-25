export interface BuyerNeed {
  description: string;
  maxMonthlyPayment: number;
  timeframeWeeks: number;
  downPayment: number;
  zip: string;
  searchSortBy?: "deal_score" | "price_asc" | "price_desc" | "mileage_asc" | "year_desc" | "distance";
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
  | "near-prime"
  | "prime"
  | "super-prime";

export interface CreditFactor {
  label: string;
  impact: "positive" | "negative" | "neutral";
  detail: string;
}

/** High-level, identity-free facts from the bureau report. */
export interface CreditReportInsights {
  bureau: string;
  scoreModel: string;
  scorePercentile?: number;
  reportDate?: string;
  revolvingUtilizationPercent?: number;
  accountCount?: number;
  latePayments?: { thirtyDays: number; sixtyDays: number; ninetyPlusDays: number };
  collections?: number;
  chargeOffs?: number;
  publicRecords?: number;
  pastDueBalance?: number;
  inquiriesLast6Months?: number;
  creditHistoryYears?: number;
}

export interface CreditReport {
  /** Where this report came from; included so the UI can distinguish sandbox data from generated demo data. */
  source?: { mode: "mock" } | { mode: "crs_sandbox"; personaId: string; bureau: string };
  insights?: CreditReportInsights;
  /** Score reason text returned by the selected bureau; no synthetic weights are attached. */
  bureauScoreFactors?: string[];
  score: number;
  tier: CreditTier;
  tierLabel: string;
  scoreRangeLabel: string;
  factors: CreditFactor[];
  /** Average used-car APR estimate for the score band; not a lender offer or approval. min/max are equal for this source. */
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
  distanceMi?: number;
  dealScore?: number;
  dealRating?: string;
  marketPriceDifference?: number;
  fuelType?: string;
  carfaxHistory?: {
    noAccidents?: boolean;
    oneOwner?: boolean;
    serviceRecords?: boolean;
    ownerCount?: number;
    accidentNotes?: string[];
    serviceNotes?: string[];
  };
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
  sustainableMonthlyPayment: number;
  /** @deprecated Use sustainableMonthlyPayment. */
  maxSustainableLoanPayment: number;
  /** @deprecated Historical name; this is the monthly payment capacity, not total ownership cost. */
  sustainableMonthlyVehicleCost: number;
  riskIndicators: FinancialRiskIndicator[];
  warnings: string[];
  assumptions: string[];
  dataQuality: "complete" | "limited";
  /** True means a positive monthly cash-flow ceiling could be estimated. */
  hasMonthlyCapacity: boolean;
  summary: string;
  /** @deprecated No vehicle-price estimate is produced. */
  maxAffordableFinancingAmount?: number | null;
  /** @deprecated No vehicle-price estimate is produced. */
  maxAffordableVehiclePrice?: number | null;
  /** @deprecated No preferred loan term is assumed. */
  preferredTermMonths?: number | null;
  /** @deprecated Use hasMonthlyCapacity; affordability does not recommend a purchase. */
  recommendedPurchase?: boolean;
}

export interface AffordableSearchConstraints {
  zip: string;
  radiusMiles: number | null;
  minPrice: number;
  /** Null means no price ceiling was inferred from monthly cash flow. */
  maxPrice: number | null;
  maxMileage: number | null;
  minYear: number | null;
  vehicleTypes: string[];
  assumptions: string[];
  /** @deprecated Monthly cash-flow limit is not a loan-payment ceiling. */
  maxMonthlyLoanPayment?: number;
  /** @deprecated Cash-flow limit is a payment-capacity estimate, not an all-in cost cap. */
  maxMonthlyVehicleCost?: number;
  /** @deprecated No loan term is inferred by the affordability assessment. */
  preferredTermMonths?: number | null;
  /** @deprecated Loan-term scenarios are evaluated separately from search constraints. */
  allowedTermsMonths?: number[];
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
  ownershipEstimateSource?: "ai" | "app";
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
  rankingSource: "bitdeer" | "bitdeer_with_fallback" | "local_fallback";
}
