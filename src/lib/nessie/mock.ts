import { SeededRandom } from "@/lib/random";
import type { AffordabilityResult, BuyerNeed, CreditReport } from "@/lib/types";

/**
 * Demo-only stand-in for a Capital One Nessie read against the buyer's accounts,
 * deposits, and bills. Used only when NESSIE_MODE=mock — the output
 * shape (AffordabilityResult) is what the rest of the pipeline consumes.
 */
export async function mockCashFlow(
  need: BuyerNeed,
  credit: CreditReport,
): Promise<AffordabilityResult> {
  await simulateLatency(600, 1000);

  const rand = new SeededRandom(`nessie:${need.zip}:${need.maxMonthlyPayment}:${credit.score}`);

  const avgMonthlyIncome = Math.round(rand.between(2900, 4600) / 10) * 10;
  const essentialExpenses = Math.round(avgMonthlyIncome * rand.between(0.42, 0.55) / 10) * 10;
  const existingDebtPayments = Math.round(avgMonthlyIncome * rand.between(0.06, 0.16) / 10) * 10;
  const discretionaryBuffer = Math.max(
    120,
    avgMonthlyIncome - essentialExpenses - existingDebtPayments,
  );

  // Lenders and responsible budgeting cap a car payment at roughly 15-20%
  // of take-home pay, net of what's already committed elsewhere.
  const safeCeiling = Math.round((avgMonthlyIncome * 0.18 - existingDebtPayments) / 5) * 5;
  const maxSustainablePayment = Math.max(
    150,
    Math.min(need.maxMonthlyPayment, safeCeiling, Math.round(discretionaryBuffer * 0.7)),
  );
  const recommendedPayment = Math.round((maxSustainablePayment * 0.88) / 5) * 5;

  const savingsBalance = Math.round(rand.between(350, 2800) / 10) * 10;
  const cashAvailableForDown = Math.round(
    Math.min(savingsBalance * 0.7, savingsBalance - 200 > 0 ? savingsBalance - 200 : 0) / 10,
  ) * 10;

  const volatilityRoll = rand.next();
  const incomeVolatility = volatilityRoll > 0.7 ? "high" : volatilityRoll > 0.4 ? "medium" : "low";

  return {
    avgMonthlyIncome,
    essentialExpenses,
    existingDebtPayments,
    discretionaryBuffer: Math.round(discretionaryBuffer),
    maxSustainablePayment,
    recommendedPayment,
    savingsBalance,
    cashAvailableForDown: Math.max(cashAvailableForDown, 0),
    incomeVolatility,
    summary: `Based on $${Math.round(avgMonthlyIncome)} in average monthly deposits and $${essentialExpenses} in recurring essentials and bills, a car payment above $${maxSustainablePayment} a month would eat into rent and groceries. We're recommending you shop for $${recommendedPayment} or less, not the $${need.maxMonthlyPayment} ceiling you gave us.`,
  };
}

function simulateLatency(minMs: number, maxMs: number) {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
