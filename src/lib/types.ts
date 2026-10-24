export interface BuyerNeed {
  description: string;
  maxMonthlyPayment: number;
  timeframeWeeks: number;
  downPayment: number;
  zip: string;
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
}

export interface LoanScenario {
  termMonths: number;
  apr: number;
  downPayment: number;
  amountFinanced: number;
  monthlyPayment: number;
  totalInterest: number;
  totalCost: number;
  negativeEquityMonths: number;
  withinBudget: boolean;
}

export interface CarAnalysis {
  listing: CarListing;
  bestScenario: LoanScenario;
  allScenarios: LoanScenario[];
  estimatedValueAt36mo: number;
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
  listings: CarListing[];
  rankedCars: RankedCar[];
  dealerPacket: DealerPacket;
  savingsHighlight: SavingsHighlight;
}
