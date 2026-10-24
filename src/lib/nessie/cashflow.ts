import { NessieError } from "@/lib/nessie/errors";
import type { NessieSnapshot } from "@/lib/nessie/types";
import type { AffordabilityResult, BuyerNeed } from "@/lib/types";

export const LOOKBACK_DAYS = 90;
export const BUCKET_DAYS = 30;
export const LOOKBACK_MONTHS = LOOKBACK_DAYS / BUCKET_DAYS;

/** Same budgeting policy as the demo mock, so both modes rank cars alike. */
export const CAR_PAYMENT_SHARE_OF_INCOME = 0.18;
export const BUFFER_SHARE_FOR_CAR = 0.7;
export const RECOMMENDED_SHARE_OF_MAX = 0.88;
export const MIN_DISCRETIONARY_BUFFER = 120;
export const MIN_SUSTAINABLE_PAYMENT = 150;

export const CREDIT_CARD_MIN_PAYMENT_RATE = 0.02;
export const CREDIT_CARD_MIN_PAYMENT_FLOOR = 25;

export const VOLATILITY_LOW_CV = 0.15;
export const VOLATILITY_MEDIUM_CV = 0.35;

const DAY_MS = 24 * 60 * 60 * 1000;

const round10 = (n: number) => Math.round(n / 10) * 10;
const round5 = (n: number) => Math.round(n / 5) * 5;
const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

/** Parses the leading `YYYY-MM-DD` of a Nessie date as UTC midnight. */
export function parseNessieDate(value: string | undefined): number | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Drops repeated records: first by `_id`, then by a content fingerprint so
 * the same transaction re-seeded under a new id is only counted once.
 */
export function dedupe<T extends { _id: string }>(records: T[], fingerprint: (record: T) => string): T[] {
  const seenIds = new Set<string>();
  const seenPrints = new Set<string>();
  const result: T[] = [];
  for (const record of records) {
    if (seenIds.has(record._id)) continue;
    seenIds.add(record._id);
    const print = fingerprint(record);
    if (seenPrints.has(print)) continue;
    seenPrints.add(print);
    result.push(record);
  }
  return result;
}

const isCancelled = (status: string | undefined) => /cancel/i.test(status ?? "");
const isCash = (medium: string | undefined) => medium !== "rewards";

export function incomeVolatility(bucketTotals: number[]): AffordabilityResult["incomeVolatility"] {
  const mean = sum(bucketTotals) / bucketTotals.length;
  if (mean <= 0) return "high";
  const variance = sum(bucketTotals.map((v) => (v - mean) ** 2)) / bucketTotals.length;
  const cv = Math.sqrt(variance) / mean;
  if (cv < VOLATILITY_LOW_CV) return "low";
  if (cv < VOLATILITY_MEDIUM_CV) return "medium";
  return "high";
}

/**
 * Step 2 on live data — turns a Nessie snapshot into the same
 * AffordabilityResult the rest of the pipeline already consumes.
 */
export function analyzeSnapshot(
  snapshot: NessieSnapshot,
  need: BuyerNeed,
  now: Date = new Date(),
): AffordabilityResult {
  const nowMs = now.getTime();
  const windowStart = nowMs - LOOKBACK_DAYS * DAY_MS;

  /** Bucket index 0..2 counting back from now, or null if outside the window. */
  const bucketOf = (date: string | undefined): number | null => {
    const ms = parseNessieDate(date);
    if (ms === null || ms > nowMs || ms <= windowStart) return null;
    return Math.min(LOOKBACK_MONTHS - 1, Math.floor((nowMs - ms) / (BUCKET_DAYS * DAY_MS)));
  };

  const accountType = new Map(snapshot.accounts.map((a) => [a._id, a.type]));

  const deposits = dedupe(
    snapshot.deposits,
    (d) => `${d.accountId}|deposit|${d.transaction_date}|${d.amount}|${d.description ?? ""}|${d.payee_id ?? ""}`,
  ).filter((d) => !isCancelled(d.status) && isCash(d.medium));

  const withdrawals = dedupe(
    snapshot.withdrawals,
    (w) => `${w.accountId}|withdrawal|${w.transaction_date}|${w.amount}|${w.description ?? ""}|${w.payer_id ?? ""}`,
  ).filter((w) => !isCancelled(w.status) && isCash(w.medium));

  const purchases = dedupe(
    snapshot.purchases,
    (p) => `${p.accountId}|purchase|${p.purchase_date}|${p.amount}|${p.description ?? ""}|${p.merchant_id ?? ""}`,
  ).filter((p) => !isCancelled(p.status) && isCash(p.medium));

  const bills = dedupe(
    snapshot.bills,
    (b) =>
      `${b.accountId}|bill|${b.payment_date ?? b.recurring_date ?? ""}|${b.payment_amount}|${b.payee ?? ""}|${b.nickname ?? ""}`,
  ).filter((b) => !isCancelled(b.status));

  const loans = dedupe(
    snapshot.loans,
    (l) => `${l.accountId}|loan|${l.creation_date ?? ""}|${l.monthly_payment}|${l.type ?? ""}|${l.amount ?? ""}`,
  );

  // Income: cash deposits into checking or savings, split into 30-day buckets.
  const incomeBuckets = new Array<number>(LOOKBACK_MONTHS).fill(0);
  let depositCount = 0;
  for (const deposit of deposits) {
    const type = accountType.get(deposit.accountId);
    if (type !== "Checking" && type !== "Savings") continue;
    const bucket = bucketOf(deposit.transaction_date);
    if (bucket === null) continue;
    incomeBuckets[bucket] += deposit.amount;
    depositCount++;
  }

  if (depositCount === 0) {
    throw new NessieError(
      "insufficient_data",
      `Not enough deposit history in the last ${LOOKBACK_DAYS} days to estimate income.`,
    );
  }

  const windowAverage = <T>(records: T[], dateOf: (r: T) => string | undefined, amountOf: (r: T) => number) =>
    sum(records.filter((r) => bucketOf(dateOf(r)) !== null).map(amountOf)) / LOOKBACK_MONTHS;

  const avgMonthlyIncome = round10(sum(incomeBuckets) / LOOKBACK_MONTHS);

  // Essentials: recurring bills monthly, one-off bills and cash withdrawals averaged over the window.
  const recurringBills = sum(bills.filter((b) => b.status === "recurring").map((b) => b.payment_amount));
  const oneOffBills = windowAverage(
    bills.filter((b) => b.status === "completed" || b.status === "pending"),
    (b) => b.payment_date,
    (b) => b.payment_amount,
  );
  const monthlyWithdrawals = windowAverage(withdrawals, (w) => w.transaction_date, (w) => w.amount);
  const essentialExpenses = round10(recurringBills + oneOffBills + monthlyWithdrawals);

  // Debt: approved loan payments plus an estimated minimum on each carried card balance.
  const loanPayments = sum(loans.filter((l) => l.status === "approved").map((l) => l.monthly_payment));
  const cardMinimums = sum(
    snapshot.accounts
      .filter((a) => a.type === "Credit Card" && a.balance > 0)
      .map((a) => Math.max(CREDIT_CARD_MIN_PAYMENT_FLOOR, a.balance * CREDIT_CARD_MIN_PAYMENT_RATE)),
  );
  const existingDebtPayments = round10(loanPayments + cardMinimums);

  const discretionarySpend = windowAverage(purchases, (p) => p.purchase_date, (p) => p.amount);

  const discretionaryBuffer = Math.max(
    MIN_DISCRETIONARY_BUFFER,
    avgMonthlyIncome - essentialExpenses - existingDebtPayments,
  );
  const safeCeiling = round5(avgMonthlyIncome * CAR_PAYMENT_SHARE_OF_INCOME - existingDebtPayments);
  const maxSustainablePayment = Math.max(
    MIN_SUSTAINABLE_PAYMENT,
    Math.min(
      need.maxMonthlyPayment,
      safeCeiling,
      Math.round((discretionaryBuffer - discretionarySpend) * BUFFER_SHARE_FOR_CAR),
    ),
  );
  const recommendedPayment = round5(maxSustainablePayment * RECOMMENDED_SHARE_OF_MAX);

  const savingsBalance = round10(
    sum(snapshot.accounts.filter((a) => a.type === "Savings").map((a) => Math.max(0, a.balance))),
  );
  const cashAvailableForDown = round10(Math.min(savingsBalance * 0.7, Math.max(0, savingsBalance - 200)));

  const accountCount = snapshot.accounts.length;

  return {
    avgMonthlyIncome,
    essentialExpenses,
    existingDebtPayments,
    discretionaryBuffer: Math.round(discretionaryBuffer),
    maxSustainablePayment,
    recommendedPayment,
    savingsBalance,
    cashAvailableForDown: Math.max(cashAvailableForDown, 0),
    incomeVolatility: incomeVolatility(incomeBuckets),
    summary: `Based on $${avgMonthlyIncome} in average monthly deposits across ${accountCount} account${accountCount === 1 ? "" : "s"} and $${essentialExpenses} in recurring essentials and bills, a car payment above $${maxSustainablePayment} a month would eat into rent and groceries. We're recommending you shop for $${recommendedPayment} or less, not the $${need.maxMonthlyPayment} ceiling you gave us.`,
  };
}
