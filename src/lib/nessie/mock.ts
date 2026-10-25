import { SeededRandom } from "@/lib/random";
import type { AffordabilityResult, BuyerNeed, CreditReport } from "@/lib/types";
import type {
  NessieAccount,
  NessieBill,
  NessieDeposit,
  NessieLoan,
  NessiePurchase,
  NessieSnapshot,
  NessieTransfer,
  NessieWithdrawal,
  WithAccount,
} from "@/lib/nessie/types";
import { getMockWrites } from "@/lib/nessie/mock-store";

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

const MOCK_ACCOUNT_SEED = "nessie:mock-demo-account";
const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysAgo(daysAgo: number, nowMs: number): string {
  return new Date(nowMs - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Demo-only stand-in for a full Capital One Nessie account snapshot. Used by
 * the Banking tab's live-account section when NESSIE_MODE=mock — independent
 * of any car search, so it's seeded with a fixed string rather than off a
 * BuyerNeed. Any deposits/withdrawals/bills added via the "+" buttons (see
 * mock-store.ts) are layered on top, so the demo stays interactive.
 */
export function mockSnapshot(now: Date = new Date()): NessieSnapshot {
  const rand = new SeededRandom(MOCK_ACCOUNT_SEED);
  const nowMs = now.getTime();

  const checkingId = "mock-checking";
  const savingsId = "mock-savings";
  const cardId = "mock-card";

  let checkingBalance = Math.round(rand.between(600, 2200) / 10) * 10;
  let savingsBalance = Math.round(rand.between(300, 2800) / 10) * 10;
  let cardBalance = Math.round(rand.between(200, 2200) / 10) * 10;

  const deposits: WithAccount<NessieDeposit>[] = [2, 16, 30, 44, 58, 72].map((daysAgo, i) => ({
    _id: `mock-deposit-${i}`,
    accountId: checkingId,
    transaction_date: isoDaysAgo(daysAgo, nowMs),
    status: "completed",
    medium: "balance",
    amount: i % 2 === 0 ? Math.round(rand.between(620, 760)) : Math.round(rand.between(120, 180)),
    description: i % 2 === 0 ? "Payroll deposit" : "Rideshare earnings",
  }));

  const withdrawals: WithAccount<NessieWithdrawal>[] = [6, 20, 48].map((daysAgo, i) => ({
    _id: `mock-withdrawal-${i}`,
    accountId: checkingId,
    transaction_date: isoDaysAgo(daysAgo, nowMs),
    status: "completed",
    medium: "balance",
    amount: Math.round(rand.between(60, 140)),
    description: "ATM cash withdrawal",
  }));

  const transfers: WithAccount<NessieTransfer>[] = [];

  const purchaseMerchants = ["Grocery Mart", "Fuel Stop", "Corner Diner", "Pharmacy", "Transit Pass"];
  const purchases: WithAccount<NessiePurchase>[] = Array.from({ length: 12 }, (_, i) => ({
    _id: `mock-purchase-${i}`,
    accountId: checkingId,
    purchase_date: isoDaysAgo(rand.int(1, 85), nowMs),
    status: "completed",
    medium: "balance",
    amount: Math.round(rand.between(8, 95)),
    description: rand.pick(purchaseMerchants),
  }));

  const cardMerchants = ["Online Shop", "Streaming Service", "Hardware Store", "Bookstore", "Coffee Shop"];
  const cardPurchases: WithAccount<NessiePurchase>[] = Array.from({ length: 6 }, (_, i) => ({
    _id: `mock-card-purchase-${i}`,
    accountId: cardId,
    purchase_date: isoDaysAgo(rand.int(1, 85), nowMs),
    status: "completed",
    medium: "balance",
    amount: Math.round(rand.between(15, 180)),
    description: rand.pick(cardMerchants),
  }));

  const bills: WithAccount<NessieBill>[] = [
    {
      _id: "mock-bill-rent",
      accountId: checkingId,
      status: "recurring",
      payee: "Maple Court Apartments",
      nickname: "Rent",
      payment_amount: Math.round(rand.between(1100, 1400) / 10) * 10,
      recurring_date: 1,
    },
    {
      _id: "mock-bill-internet",
      accountId: checkingId,
      status: "recurring",
      payee: "Citywide Internet",
      nickname: "Internet",
      payment_amount: Math.round(rand.between(50, 75)),
      recurring_date: 12,
    },
  ];

  const loans: WithAccount<NessieLoan>[] = [
    {
      _id: "mock-loan-1",
      accountId: checkingId,
      type: "installment",
      status: "approved",
      monthly_payment: Math.round(rand.between(110, 180)),
      amount: Math.round(rand.between(2500, 5000)),
      creation_date: isoDaysAgo(200, nowMs),
      description: "Equipment loan",
    },
  ];

  // Layer on anything added this session via the "+" buttons.
  const writes = getMockWrites();
  writes.deposits.forEach((w, i) => {
    checkingBalance += w.amount;
    deposits.unshift({
      _id: `mock-deposit-live-${i}`,
      accountId: checkingId,
      transaction_date: w.date,
      status: "completed",
      medium: "balance",
      amount: w.amount,
      description: w.description,
    });
  });
  writes.withdrawals.forEach((w, i) => {
    checkingBalance -= w.amount;
    withdrawals.unshift({
      _id: `mock-withdrawal-live-${i}`,
      accountId: checkingId,
      transaction_date: w.date,
      status: "completed",
      medium: "balance",
      amount: w.amount,
      description: w.description,
    });
  });
  writes.transfers.forEach((w, i) => {
    checkingBalance -= w.amount;
    savingsBalance += w.amount;
    transfers.unshift({
      _id: `mock-transfer-live-${i}`,
      accountId: checkingId,
      transaction_date: w.date,
      status: "completed",
      payee_id: savingsId,
      amount: w.amount,
      description: w.description,
    });
  });
  writes.purchases.forEach((w, i) => {
    cardBalance += w.amount;
    cardPurchases.unshift({
      _id: `mock-card-purchase-live-${i}`,
      accountId: cardId,
      purchase_date: w.date,
      status: "completed",
      medium: "balance",
      amount: w.amount,
      description: w.description,
    });
  });
  writes.bills.forEach((w, i) => {
    bills.unshift({
      _id: `mock-bill-live-${i}`,
      accountId: checkingId,
      status: "recurring",
      payee: w.payee,
      nickname: w.nickname,
      payment_amount: w.amount,
      recurring_date: w.dayOfMonth,
    });
  });

  const accounts: NessieAccount[] = [
    { _id: checkingId, type: "Checking", nickname: "360 Checking", balance: Math.round(checkingBalance * 100) / 100 },
    { _id: savingsId, type: "Savings", nickname: "360 Performance Savings", balance: Math.round(savingsBalance * 100) / 100 },
    { _id: cardId, type: "Credit Card", nickname: "Savor Rewards", balance: Math.round(cardBalance * 100) / 100 },
  ];

  return {
    accounts,
    deposits,
    withdrawals,
    purchases: [...purchases, ...cardPurchases],
    transfers,
    bills,
    loans,
    dropped: 0,
  };
}
