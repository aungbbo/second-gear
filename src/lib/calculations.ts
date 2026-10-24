import type { LoanScenario } from "@/lib/types";

export const LOAN_TERMS_MONTHS = [36, 48, 60, 72] as const;

/** Standard amortizing monthly payment. */
export function monthlyPayment(principal: number, annualAprPercent: number, termMonths: number): number {
  if (principal <= 0) return 0;
  const r = annualAprPercent / 100 / 12;
  if (r === 0) return principal / termMonths;
  const factor = Math.pow(1 + r, termMonths);
  return (principal * r * factor) / (factor - 1);
}

/** Remaining balance after each payment, index 0 = before any payment. */
export function amortizationSchedule(
  principal: number,
  annualAprPercent: number,
  termMonths: number,
): number[] {
  const payment = monthlyPayment(principal, annualAprPercent, termMonths);
  const r = annualAprPercent / 100 / 12;
  const balances: number[] = [principal];
  let balance = principal;
  for (let m = 1; m <= termMonths; m++) {
    const interest = balance * r;
    balance = Math.max(0, balance + interest - payment);
    balances.push(balance);
  }
  return balances;
}

/**
 * Rough used-car depreciation curve: ~18% in year one, ~11%/year after,
 * applied against the price actually paid at purchase.
 */
export function depreciatedValue(purchasePrice: number, months: number): number {
  if (months <= 12) {
    const factor = 1 - (0.18 * months) / 12;
    return purchasePrice * factor;
  }
  const afterYearOne = purchasePrice * 0.82;
  const extraYears = (months - 12) / 12;
  return afterYearOne * Math.pow(0.89, extraYears);
}

/** How many months the loan balance exceeds what the car is worth. */
export function countNegativeEquityMonths(
  schedule: number[],
  purchasePrice: number,
): number {
  let months = 0;
  for (let m = 0; m < schedule.length; m++) {
    if (schedule[m] > depreciatedValue(purchasePrice, m)) months++;
  }
  return months;
}

/** APR edges up slightly on longer terms, reflecting real subprime pricing. */
export function aprForTerm(baseAprMin: number, baseAprMax: number, termMonths: number): number {
  const base = (baseAprMin + baseAprMax) / 2;
  const escalation = ((termMonths - 36) / 36) * 1.6;
  return Math.round((base + escalation) * 10) / 10;
}

export function buildLoanScenario(
  price: number,
  downPayment: number,
  aprMin: number,
  aprMax: number,
  termMonths: number,
  maxSustainablePayment: number,
): LoanScenario {
  const amountFinanced = Math.max(0, price - downPayment);
  const apr = aprForTerm(aprMin, aprMax, termMonths);
  const payment = monthlyPayment(amountFinanced, apr, termMonths);
  const totalCost = payment * termMonths + downPayment;
  const totalInterest = totalCost - price;
  const schedule = amortizationSchedule(amountFinanced, apr, termMonths);
  const negativeEquityMonths = countNegativeEquityMonths(schedule, price);

  return {
    termMonths,
    apr,
    downPayment,
    amountFinanced,
    monthlyPayment: Math.round(payment),
    totalInterest: Math.round(totalInterest),
    totalCost: Math.round(totalCost),
    negativeEquityMonths,
    withinBudget: payment <= maxSustainablePayment + 0.5,
  };
}

export function buildAllScenarios(
  price: number,
  downPayment: number,
  aprMin: number,
  aprMax: number,
  maxSustainablePayment: number,
): LoanScenario[] {
  return LOAN_TERMS_MONTHS.map((term) =>
    buildLoanScenario(price, downPayment, aprMin, aprMax, term, maxSustainablePayment),
  );
}

/** Inverse of monthlyPayment: how much principal a given payment affords. */
export function principalForPayment(payment: number, annualAprPercent: number, termMonths: number): number {
  const r = annualAprPercent / 100 / 12;
  if (r === 0) return payment * termMonths;
  return (payment * (1 - Math.pow(1 + r, -termMonths))) / r;
}

export function pickBestScenario(scenarios: LoanScenario[]): LoanScenario {
  const affordable = scenarios.filter((s) => s.withinBudget);
  const pool = affordable.length > 0 ? affordable : scenarios;
  return [...pool].sort((a, b) => a.totalInterest - b.totalInterest)[0];
}
