import { LOAN_TERMS_MONTHS, principalForPayment } from "@/lib/calculations";
import type {
  AffordabilityAssessment,
  AffordabilityResult,
  BuyerNeed,
  CreditReport,
  FinancialRiskIndicator,
} from "@/lib/types";
import {
  calculateOwnershipCosts,
  DEFAULT_OWNERSHIP_COST_ASSUMPTIONS,
  type OwnershipCostAssumptions,
} from "@/lib/affordability/ownership";

export interface AssessmentOptions {
  preferredTermMonths?: number;
  emergencyReserveMonths?: number;
  referenceVehiclePrice?: number;
  referenceMpg?: number;
  ownershipAssumptions?: Partial<OwnershipCostAssumptions>;
}

const DEFAULT_PREFERRED_TERM = 60;
const DEFAULT_EMERGENCY_RESERVE_MONTHS = 3;
export const DEFAULT_REFERENCE_VEHICLE_PRICE = 15_000;
const roundMoney = (value: number) => Math.max(0, Math.round(value));
const roundPrice = (value: number) => Math.max(0, Math.floor(value / 100) * 100);

function preferredTerm(value: number | undefined): number {
  return value !== undefined && LOAN_TERMS_MONTHS.includes(value as (typeof LOAN_TERMS_MONTHS)[number])
    ? value
    : DEFAULT_PREFERRED_TERM;
}

function risk(
  code: string,
  severity: FinancialRiskIndicator["severity"],
  label: string,
  detail: string,
): FinancialRiskIndicator {
  return { code, severity, label, detail };
}

/**
 * Converts the existing Nessie cash-flow result and CRS APR estimate into a
 * separate, explicit affordability assessment. The legacy maxSustainablePayment
 * remains the cash-flow ceiling; this engine subtracts estimated ownership
 * costs before calculating a vehicle price range.
 */
export function assessAffordability(
  need: BuyerNeed,
  credit: CreditReport,
  cashFlow: AffordabilityResult,
  options: AssessmentOptions = {},
): AffordabilityAssessment {
  const termMonths = preferredTerm(options.preferredTermMonths);
  const reserveMonths = options.emergencyReserveMonths !== undefined && options.emergencyReserveMonths > 0
    ? options.emergencyReserveMonths
    : DEFAULT_EMERGENCY_RESERVE_MONTHS;
  const disposableIncome = cashFlow.avgMonthlyIncome - cashFlow.essentialExpenses - cashFlow.existingDebtPayments;
  const emergencyReserveRequired = roundMoney((cashFlow.essentialExpenses + cashFlow.existingDebtPayments) * reserveMonths);
  const liquidAfterReserve = Math.max(0, cashFlow.savingsBalance - emergencyReserveRequired);
  const safeDownPayment = roundMoney(
    Math.min(need.downPayment, cashFlow.cashAvailableForDown, liquidAfterReserve * 0.7),
  );
  const sustainableMonthlyVehicleCost = roundMoney(
    Math.min(Math.max(0, need.maxMonthlyPayment), Math.max(0, cashFlow.maxSustainablePayment)),
  );

  const referencePrice = Math.max(
    safeDownPayment,
    options.referenceVehiclePrice ?? DEFAULT_REFERENCE_VEHICLE_PRICE,
  );
  const referenceCosts = calculateOwnershipCosts({
    listingPrice: referencePrice,
    mpgCombined: options.referenceMpg ?? DEFAULT_OWNERSHIP_COST_ASSUMPTIONS.defaultMpg,
    monthlyLoanPayment: 0,
    downPayment: safeDownPayment,
    overrides: need.ownershipCostOverrides,
    assumptions: options.ownershipAssumptions,
  });

  let maxSustainableLoanPayment = Math.max(0, sustainableMonthlyVehicleCost - referenceCosts.recurringMonthly);
  let maxAffordableFinancingAmount = principalForPayment(maxSustainableLoanPayment, credit.estimatedApr.min, termMonths);
  let maxAffordableVehiclePrice = Math.max(0, maxAffordableFinancingAmount + safeDownPayment - referenceCosts.dealerFees);

  // Registration, taxes, and maintenance vary with price. One refinement keeps
  // the result responsive without pretending these estimates are exact.
  const refinedCosts = calculateOwnershipCosts({
    listingPrice: maxAffordableVehiclePrice,
    mpgCombined: options.referenceMpg ?? DEFAULT_OWNERSHIP_COST_ASSUMPTIONS.defaultMpg,
    monthlyLoanPayment: 0,
    downPayment: safeDownPayment,
    overrides: need.ownershipCostOverrides,
    assumptions: options.ownershipAssumptions,
  });
  maxSustainableLoanPayment = Math.max(0, sustainableMonthlyVehicleCost - refinedCosts.recurringMonthly);
  maxAffordableFinancingAmount = principalForPayment(maxSustainableLoanPayment, credit.estimatedApr.min, termMonths);
  maxAffordableVehiclePrice = roundPrice(maxAffordableFinancingAmount + safeDownPayment - refinedCosts.dealerFees);

  const indicators: FinancialRiskIndicator[] = [];
  const warnings: string[] = [];
  const debtRatio = cashFlow.avgMonthlyIncome > 0 ? cashFlow.existingDebtPayments / cashFlow.avgMonthlyIncome : 1;

  if (cashFlow.savingsBalance < emergencyReserveRequired) {
    indicators.push(risk("thin_reserves", "high", "Emergency savings are thin", "Savings do not cover the configured emergency reserve target."));
    warnings.push("Keep an emergency reserve before using savings for a vehicle purchase.");
  } else if (cashFlow.savingsBalance < emergencyReserveRequired * 1.5) {
    indicators.push(risk("limited_reserves", "medium", "Emergency savings are limited", "The purchase would leave a smaller-than-preferred cash cushion."));
  }

  if (debtRatio >= 0.4) {
    indicators.push(risk("high_debt_burden", "high", "Existing debt burden is high", "Existing debt payments consume at least 40% of average monthly income."));
    warnings.push("Existing debt leaves little room for another recurring payment.");
  } else if (debtRatio >= 0.3) {
    indicators.push(risk("elevated_debt_burden", "medium", "Existing debt burden is elevated", "Existing debt payments consume at least 30% of average monthly income."));
  }

  if (cashFlow.incomeVolatility === "high") {
    indicators.push(risk("income_volatility", "high", "Income varies significantly", "Use a lower payment target because recent income is inconsistent."));
    warnings.push("Variable income makes a new vehicle payment harder to sustain.");
  } else if (cashFlow.incomeVolatility === "medium") {
    indicators.push(risk("income_variability", "medium", "Income is somewhat variable", "A payment below the ceiling leaves more room for weaker months."));
  }

  if (credit.estimatedApr.max >= 18) {
    indicators.push(risk("high_apr_estimate", "high", "Estimated APR is high", "The application-generated APR estimate materially increases financing cost; it is not a lender offer."));
    warnings.push("High estimated APR makes longer terms and expensive vehicles especially risky.");
  }

  if (maxSustainableLoanPayment <= 0 || maxAffordableVehiclePrice <= 0) {
    indicators.push(risk("no_vehicle_payment_room", "high", "No sustainable vehicle payment remains", "Estimated ownership costs use the available monthly vehicle-cost ceiling."));
    warnings.push("No vehicle purchase is financially sustainable under the current inputs.");
  }

  if (need.maxMonthlyPayment > cashFlow.maxSustainablePayment) {
    warnings.push(`Your stated $${need.maxMonthlyPayment} monthly ceiling is higher than the cash-flow-based sustainable ceiling.`);
  }

  const dataQuality =
    cashFlow.avgMonthlyIncome > 0 &&
    Number.isFinite(cashFlow.essentialExpenses) &&
    Number.isFinite(cashFlow.existingDebtPayments) &&
    Number.isFinite(cashFlow.savingsBalance) &&
    credit.estimatedApr.min >= 0 &&
    credit.estimatedApr.max >= credit.estimatedApr.min
      ? "complete"
      : "limited";
  if (dataQuality === "limited") warnings.push("Some financial inputs are missing or invalid, so a safe purchase recommendation is unavailable.");

  const recommendedPurchase = dataQuality === "complete" && maxAffordableVehiclePrice > 0 && maxSustainableLoanPayment > 0;
  const summary = recommendedPurchase
    ? `After essentials, existing debt, ownership-cost estimates, and a ${reserveMonths}-month emergency reserve, an estimated loan payment up to $${roundMoney(maxSustainableLoanPayment)}/mo supports a vehicle price near $${roundPrice(maxAffordableVehiclePrice).toLocaleString()} with the current inputs. Ownership costs are estimates, and the CRS APR range is application-generated, not a lender offer.`
    : "Based on the current income, expenses, savings, credit estimate, and ownership costs, the engine does not recommend purchasing a vehicle right now.";

  return {
    statedMonthlyBudget: roundMoney(need.maxMonthlyPayment),
    disposableIncomeAfterEssentialsAndDebt: Math.round(disposableIncome),
    emergencyReserveRequired,
    safeDownPayment,
    maxSustainableLoanPayment: roundMoney(maxSustainableLoanPayment),
    sustainableMonthlyVehicleCost,
    maxAffordableFinancingAmount: roundMoney(maxAffordableFinancingAmount),
    maxAffordableVehiclePrice,
    preferredTermMonths: termMonths,
    riskIndicators: indicators,
    warnings: [...new Set(warnings)],
    assumptions: [
      `Emergency reserve target is ${reserveMonths} months of essential expenses plus existing debt payments.`,
      `Reference vehicle price for variable ownership-cost estimates is $${DEFAULT_REFERENCE_VEHICLE_PRICE.toLocaleString()} unless overridden by the caller.`,
      "Insurance, fuel, maintenance, registration, and taxes are estimates unless the buyer supplies overrides.",
      "The CRS APR range is application-generated and is not a lender offer or approval.",
    ],
    dataQuality,
    recommendedPurchase,
    summary,
  };
}
