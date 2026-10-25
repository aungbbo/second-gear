import type {
  AffordabilityAssessment,
  AffordabilityResult,
  BuyerNeed,
  CreditReport,
  FinancialRiskIndicator,
} from "@/lib/types";

export interface AssessmentOptions {
  emergencyReserveMonths?: number;
}

const DEFAULT_EMERGENCY_RESERVE_MONTHS = 3;
const roundMoney = (value: number) => Math.max(0, Math.round(value));

function risk(
  code: string,
  severity: FinancialRiskIndicator["severity"],
  label: string,
  detail: string,
): FinancialRiskIndicator {
  return { code, severity, label, detail };
}

/**
 * Estimates a monthly vehicle-cost ceiling from user budget and observed cash
 * flow. It deliberately does not convert that ceiling into a vehicle price:
 * that conversion would require a loan APR and term that the user has not
 * provided. Listing-specific loan scenarios are evaluated separately.
 */
export function assessAffordability(
  need: BuyerNeed,
  _credit: CreditReport,
  cashFlow: AffordabilityResult,
  options: AssessmentOptions = {},
): AffordabilityAssessment {
  const reserveMonths = options.emergencyReserveMonths !== undefined && options.emergencyReserveMonths > 0
    ? options.emergencyReserveMonths
    : DEFAULT_EMERGENCY_RESERVE_MONTHS;
  const disposableIncome = cashFlow.avgMonthlyIncome - cashFlow.essentialExpenses - cashFlow.existingDebtPayments;
  const emergencyReserveRequired = roundMoney((cashFlow.essentialExpenses + cashFlow.existingDebtPayments) * reserveMonths);
  const liquidAfterReserve = Math.max(0, cashFlow.savingsBalance - emergencyReserveRequired);
  const safeDownPayment = roundMoney(
    Math.min(need.downPayment, cashFlow.cashAvailableForDown, liquidAfterReserve * 0.7),
  );
  const sustainableMonthlyPayment = roundMoney(
    Math.min(Math.max(0, need.maxMonthlyPayment), Math.max(0, cashFlow.maxSustainablePayment)),
  );

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

  if (sustainableMonthlyPayment <= 0) {
    indicators.push(risk("no_vehicle_payment_room", "high", "No monthly payment capacity remains", "The current budget and cash-flow inputs leave no monthly car-payment capacity."));
    warnings.push("No monthly car-payment capacity remains under the current inputs.");
  }

  if (need.maxMonthlyPayment > cashFlow.maxSustainablePayment) {
    warnings.push(`Your stated $${need.maxMonthlyPayment} monthly ceiling is higher than the cash-flow-based sustainable ceiling.`);
  }

  const dataQuality =
    cashFlow.avgMonthlyIncome > 0 &&
    Number.isFinite(cashFlow.essentialExpenses) &&
    Number.isFinite(cashFlow.existingDebtPayments) &&
    Number.isFinite(cashFlow.savingsBalance) &&
    Number.isFinite(cashFlow.maxSustainablePayment)
      ? "complete"
      : "limited";
  if (dataQuality === "limited") warnings.push("Some financial inputs are missing or invalid, so monthly payment capacity cannot be estimated safely.");

  const hasMonthlyCapacity = dataQuality === "complete" && sustainableMonthlyPayment > 0;
  const summary = hasMonthlyCapacity
    ? `Based on recent bank activity and your stated budget, estimated monthly car-payment capacity is $${roundMoney(sustainableMonthlyPayment)}/mo. This is a cash-flow estimate, not a loan offer or vehicle price recommendation.`
    : "Based on the current income, expenses, and debt information, the engine cannot estimate positive monthly car-payment capacity.";

  return {
    statedMonthlyBudget: roundMoney(need.maxMonthlyPayment),
    disposableIncomeAfterEssentialsAndDebt: Math.round(disposableIncome),
    emergencyReserveRequired,
    safeDownPayment,
    sustainableMonthlyPayment,
    maxSustainableLoanPayment: sustainableMonthlyPayment,
    sustainableMonthlyVehicleCost: sustainableMonthlyPayment,
    riskIndicators: indicators,
    warnings: [...new Set(warnings)],
    assumptions: [
      `Emergency reserve target is ${reserveMonths} months of essential expenses plus existing debt payments.`,
      "No APR, loan term, or vehicle price cap is inferred in this cash-flow assessment.",
      "The monthly ceiling is an estimate from recent bank activity and the user's stated budget, not a lender decision.",
    ],
    dataQuality,
    hasMonthlyCapacity,
    summary,
  };
}
