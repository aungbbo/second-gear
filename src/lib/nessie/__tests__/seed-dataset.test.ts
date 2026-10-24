import { describe, expect, it } from "vitest";
import { analyzeSnapshotWithStats, parseNessieDate } from "@/lib/nessie/cashflow";
import { buildSeedDataset, DEFAULT_PERSONA, isoDay, SEED_MARKER } from "../../../../scripts/nessie-seed/dataset.mjs";
import { NEED, seedSnapshot } from "./fixtures";

const AS_OF = "2026-10-24";
const AS_OF_NOON = new Date(`${AS_OF}T12:00:00Z`);
const DAY_MS = 24 * 60 * 60 * 1000;

const dataset = buildSeedDataset({ asOf: AS_OF });
const analyze = (maxMonthlyPayment: number, loansSupported = true) =>
  analyzeSnapshotWithStats(seedSnapshot(dataset, { loansSupported }), { ...NEED, maxMonthlyPayment }, AS_OF_NOON);

const datedRecords = () => [
  ...dataset.deposits.map((r) => r.body.transaction_date),
  ...dataset.withdrawals.map((r) => r.body.transaction_date),
  ...dataset.purchases.map((r) => r.body.purchase_date),
  ...dataset.bills.flatMap((r) => ("payment_date" in r.body ? [r.body.payment_date] : [])),
];

describe("seed dataset → analyzer", () => {
  it("produces the planned affordability for a $400 budget", () => {
    expect(analyze(400).result).toMatchObject({
      avgMonthlyIncome: 3450,
      essentialExpenses: 1530,
      existingDebtPayments: 180,
      discretionaryBuffer: 1740,
      maxSustainablePayment: 400,
      recommendedPayment: 350,
      savingsBalance: 2400,
      cashAvailableForDown: 1680,
      incomeVolatility: "low",
    });
  });

  it("produces the planned affordability for a $600 budget (18% rule binds)", () => {
    expect(analyze(600).result).toMatchObject({ maxSustainablePayment: 440, recommendedPayment: 385 });
  });

  it("still analyzes cleanly if the sandbox has no loans endpoint", () => {
    expect(analyze(600, false).result).toMatchObject({
      existingDebtPayments: 40,
      discretionaryBuffer: 1880,
      maxSustainablePayment: 580,
      recommendedPayment: 510,
    });
  });

  it("is clean data: no malformed, invalid-date, or duplicate records", () => {
    expect(analyze(400).stats).toEqual({ malformed: 0, invalidDates: 0, duplicates: 0 });
  });
});

describe("seed dataset shape", () => {
  it("keeps every dated record 1–85 days old and none in the future", () => {
    for (const date of datedRecords()) {
      const ms = parseNessieDate(date);
      expect(ms).not.toBeNull();
      const ageDays = (AS_OF_NOON.getTime() - ms!) / DAY_MS;
      expect(ageDays).toBeGreaterThanOrEqual(1);
      expect(ageDays).toBeLessThanOrEqual(85);
    }
  });

  it("puts exactly $3450 of income in each 30-day bucket", () => {
    const buckets = [0, 0, 0];
    for (const { body } of dataset.deposits) {
      const age = (AS_OF_NOON.getTime() - parseNessieDate(body.transaction_date)!) / DAY_MS;
      buckets[Math.floor(age / 30)] += body.amount;
    }
    expect(buckets).toEqual([3450, 3450, 3450]);
  });

  it("uses positive whole-dollar amounts and valid Nessie enums", () => {
    const amounts = [
      ...dataset.accounts.map((a) => a.body.balance),
      ...dataset.deposits.map((r) => r.body.amount),
      ...dataset.withdrawals.map((r) => r.body.amount),
      ...dataset.purchases.map((r) => r.body.amount),
      ...dataset.bills.map((r) => r.body.payment_amount),
      ...dataset.loans.flatMap((r) => [r.body.amount, r.body.monthly_payment, r.body.credit_score]),
    ];
    for (const amount of amounts) {
      expect(Number.isInteger(amount) && amount > 0).toBe(true);
    }
    expect(dataset.accounts.map((a) => a.body.type)).toEqual(["Checking", "Savings", "Credit Card"]);
    for (const { body } of [...dataset.deposits, ...dataset.withdrawals, ...dataset.purchases]) {
      expect(body.medium).toBe("balance");
    }
    for (const { body } of dataset.bills) {
      expect(["pending", "recurring", "cancelled", "completed"]).toContain(body.status);
      if ("recurring_date" in body) expect(body.recurring_date).toBeGreaterThanOrEqual(1);
      if ("recurring_date" in body) expect(body.recurring_date).toBeLessThanOrEqual(28);
    }
    for (const { body } of dataset.loans) {
      expect(["auto", "home", "small business"]).toContain(body.type);
      expect(["pending", "approved", "declined"]).toContain(body.status);
    }
  });

  it("marks every record and ties the customer to the persona", () => {
    const labels = [
      ...dataset.deposits.map((r) => r.body.description),
      ...dataset.withdrawals.map((r) => r.body.description),
      ...dataset.purchases.map((r) => r.body.description),
      ...dataset.bills.map((r) => r.body.nickname),
      ...dataset.loans.map((r) => r.body.description),
    ];
    for (const label of labels) expect(label.startsWith(SEED_MARKER)).toBe(true);
    expect(dataset.customer.last_name).toContain(DEFAULT_PERSONA);
    expect(dataset.persona).toBe(DEFAULT_PERSONA);
  });

  it("avoids double counting: no rent/loan withdrawals, no savings deposits, nothing on the card", () => {
    const billAmounts = new Set(dataset.bills.map((r) => r.body.payment_amount));
    const loanAmounts = new Set(dataset.loans.map((r) => r.body.monthly_payment));
    for (const { body } of dataset.withdrawals) {
      expect(billAmounts.has(body.amount) || loanAmounts.has(body.amount)).toBe(false);
    }
    const transacting = [...dataset.deposits, ...dataset.withdrawals, ...dataset.purchases, ...dataset.bills, ...dataset.loans];
    expect(transacting.every((r) => r.account === "checking")).toBe(true);
  });

  it("is deterministic and shifts every date with asOf", () => {
    expect(buildSeedDataset({ asOf: AS_OF })).toEqual(dataset);
    const later = buildSeedDataset({ asOf: isoDay(AS_OF, -7) });
    const shift = (date: string) => (parseNessieDate(date)! - parseNessieDate(isoDay(date, 7))!) / DAY_MS;
    expect(later.deposits.map((r) => r.body.transaction_date)).toEqual(
      dataset.deposits.map((r) => isoDay(r.body.transaction_date, -7)),
    );
    expect(shift(dataset.deposits[0].body.transaction_date)).toBe(7);
  });

  it("contains no key- or id-shaped strings", () => {
    const text = JSON.stringify(dataset);
    const keyOrIdShaped = /\b[0-9a-f]{24,32}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
    expect(keyOrIdShaped.test(text)).toBe(false);
  });
});
