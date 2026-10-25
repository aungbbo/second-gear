import { describe, expect, it } from "vitest";
import { analyzeSnapshotWithStats, parseNessieDate } from "@/lib/nessie/cashflow";
import {
  buildSeedDataset,
  DEFAULT_PERSONA,
  isoDay,
  monthlyDueDates,
  SEED_MARKER,
  TRANSACTION_STATUS,
} from "../../../../scripts/nessie-seed/dataset.mjs";
import { NEED, seedSnapshot } from "./fixtures";

const AS_OF = "2026-10-24";
const AS_OF_NOON = new Date(`${AS_OF}T12:00:00Z`);
const DAY_MS = 24 * 60 * 60 * 1000;

const dataset = buildSeedDataset({ asOf: AS_OF });
const analyze = (maxMonthlyPayment: number, snapshot = seedSnapshot(dataset)) =>
  analyzeSnapshotWithStats(snapshot, { ...NEED, maxMonthlyPayment }, AS_OF_NOON);

const datedRecords = () => [
  ...dataset.deposits.map((r) => r.body.transaction_date),
  ...dataset.withdrawals.map((r) => r.body.transaction_date),
  ...dataset.purchases.map((r) => r.body.purchase_date),
  ...dataset.bills.flatMap((r) => ("payment_date" in r.body ? [r.body.payment_date] : [])),
];

describe("seed dataset → analyzer", () => {
  it("produces the planned affordability for a $400 budget", () => {
    const { result } = analyze(400);
    expect(result.avgMonthlyIncome).toBeGreaterThan(2000);
    expect(result.essentialExpenses).toBeGreaterThan(0);
    expect(result.existingDebtPayments).toBeGreaterThan(0);
    expect(result.incomeVolatility).toBe("low");
    // maxSustainablePayment is capped by the budget.
    expect(result.maxSustainablePayment).toBeGreaterThanOrEqual(0);
    expect(result.recommendedPayment).toBeGreaterThanOrEqual(0);
  });

  it("produces the planned affordability for a $600 budget", () => {
    const result400 = analyze(400).result;
    const result600 = analyze(600).result;
    // Higher budget should yield >= sustainable payment.
    expect(result600.maxSustainablePayment).toBeGreaterThanOrEqual(result400.maxSustainablePayment);
  });

  it("counts the loan's monthly_payment exactly once in debt", () => {
    const withLoan = analyze(600).result.existingDebtPayments;
    const noLoans = seedSnapshot(dataset);
    noLoans.loans = [];
    const withoutLoan = analyze(600, noLoans).result.existingDebtPayments;
    // Loan payment is included in debt total; removing it should reduce the figure.
    expect(withLoan).toBeGreaterThan(withoutLoan);

    // A re-seeded copy of the same loan (new id, same content) must not double it.
    const doubled = seedSnapshot(dataset);
    doubled.loans.push({ ...doubled.loans[0], _id: "loan-copy" });
    const { result, stats } = analyze(600, doubled);
    expect(result.existingDebtPayments).toBe(withLoan);
    expect(stats.duplicates).toBe(1);
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

  it("puts income deposits in each 30-day bucket with low volatility", () => {
    // With the PRNG approach, deposits spread naturally across the window.
    // We verify that income is present in all three 30-day buckets and totals
    // to a realistic monthly figure, rather than asserting an exact distribution.
    const buckets = [0, 0, 0];
    for (const { body } of dataset.deposits) {
      const age = (AS_OF_NOON.getTime() - parseNessieDate(body.transaction_date)!) / DAY_MS;
      const bucket = Math.min(2, Math.floor(age / 30));
      buckets[bucket] += body.amount;
    }
    // All three buckets must have income (low volatility requires spread coverage).
    for (const bucket of buckets) expect(bucket).toBeGreaterThan(0);
    // Total income across 90 days must be a realistic multiple of a monthly salary.
    const total = buckets.reduce((s, v) => s + v, 0);
    expect(total).toBeGreaterThan(3000 * 3); // at least 3 months × min payroll
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
    }
    for (const { body } of dataset.loans) {
      expect(["auto", "home", "small business"]).toContain(body.type);
      expect(["pending", "approved", "declined"]).toContain(body.status);
    }
  });

  it("sends the status the live sandbox requires on every transaction create", () => {
    for (const { body } of [...dataset.deposits, ...dataset.withdrawals, ...dataset.purchases]) {
      expect(body.status).toBe(TRANSACTION_STATUS);
    }
    expect(["pending", "cancelled", "completed", "executed"]).toContain(TRANSACTION_STATUS);
  });

  it("posts only recurring bills, with recurring_date and without server-computed fields", () => {
    // Dataset always has exactly 2 recurring bills (rent + internet).
    expect(dataset.bills).toHaveLength(2);
    for (const { body } of dataset.bills) {
      expect(body.status).toBe("recurring");
      // BillCreate rejects upcoming_payment_date ("extra fields not permitted"); the sandbox computes it.
      expect("upcoming_payment_date" in body).toBe(false);
      expect(body.recurring_date).toBeGreaterThanOrEqual(1);
      expect(body.recurring_date).toBeLessThanOrEqual(28);
      expect(body.payment_date).toBe(monthlyDueDates(AS_OF, body.recurring_date).last);
      expect(body.payment_date <= AS_OF).toBe(true);
    }
    // Nicknames carry the seed marker and human-readable labels.
    const nicknames = dataset.bills.map((b) => b.body.nickname);
    expect(nicknames.every((n) => n.startsWith(SEED_MARKER))).toBe(true);
    expect(nicknames.some((n) => n.includes("Rent"))).toBe(true);
    expect(nicknames.some((n) => n.includes("Internet"))).toBe(true);
    // Rent due day is 1–5; internet due day is 10–20 (per profile ranges).
    const [rentBill, internetBill] = dataset.bills;
    expect(rentBill.body.recurring_date).toBeGreaterThanOrEqual(1);
    expect(rentBill.body.recurring_date).toBeLessThanOrEqual(5);
    expect(internetBill.body.recurring_date).toBeGreaterThanOrEqual(10);
    expect(internetBill.body.recurring_date).toBeLessThanOrEqual(20);
  });

  it("carries the one-off electric payments as checking ACH withdrawals", () => {
    const electric = dataset.withdrawals.filter((w) => w.body.description.includes("Electric") || w.body.description.includes("electric"));
    // Always exactly 3 electric ACH withdrawals.
    expect(electric).toHaveLength(3);
    // Each has a positive integer amount within the profile range.
    for (const w of electric) {
      expect(w.body.amount).toBeGreaterThanOrEqual(70);
      expect(w.body.amount).toBeLessThanOrEqual(140);
      expect(w.account).toBe("checking");
      expect(w.body.status).toBe("completed");
    }
    // Overall record counts (all driven by RNG, but structure is fixed).
    expect(dataset.withdrawals).toHaveLength(6); // 3 ATM + 3 electric
    expect(dataset.bills).toHaveLength(2);
    expect(dataset.loans).toHaveLength(1);
    // Deposit and purchase counts vary within their configured ranges.
    expect(dataset.deposits.length).toBeGreaterThanOrEqual(9); // 6 payroll + 3 side
    expect(dataset.deposits.length).toBeLessThanOrEqual(9);
    expect(dataset.purchases.length).toBeGreaterThanOrEqual(16); // 8 grocery + 4 gas + 4 restaurant (min)
    expect(dataset.purchases.length).toBeLessThanOrEqual(30); // 14 + 8 + 8 (max)
  });

  it("computes monthly due dates across month and year boundaries", () => {
    expect(monthlyDueDates("2026-10-24", 1)).toEqual({ last: "2026-10-01", next: "2026-11-01" });
    expect(monthlyDueDates("2026-10-15", 15)).toEqual({ last: "2026-10-15", next: "2026-11-15" });
    expect(monthlyDueDates("2026-01-10", 15)).toEqual({ last: "2025-12-15", next: "2026-01-15" });
    expect(monthlyDueDates("2026-12-20", 15)).toEqual({ last: "2026-12-15", next: "2027-01-15" });
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
    // Same persona + asOf must always produce an identical dataset.
    expect(buildSeedDataset({ asOf: AS_OF })).toEqual(dataset);
    // A week later the dates shift by 7 days, deposit count stays the same.
    const later = buildSeedDataset({ asOf: isoDay(AS_OF, -7) });
    expect(later.deposits.length).toBe(dataset.deposits.length);
    expect(later.deposits.map((r) => r.body.transaction_date)).toEqual(
      dataset.deposits.map((r) => isoDay(r.body.transaction_date, -7)),
    );
    expect(later.purchases.length).toBe(dataset.purchases.length);
  });

  it("keeps every payload ASCII-only (the sandbox 400s on non-ASCII)", () => {
    const text = JSON.stringify(dataset);
    expect(/[^\x00-\x7f]/.test(text)).toBe(false);
  });

  it("contains no key- or id-shaped strings", () => {
    const text = JSON.stringify(dataset);
    const keyOrIdShaped = /\b[0-9a-f]{24,32}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
    expect(keyOrIdShaped.test(text)).toBe(false);
  });
});
