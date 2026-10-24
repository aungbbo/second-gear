import { describe, expect, it } from "vitest";
import { analyzeSnapshot, dedupe, incomeVolatility, parseNessieDate } from "@/lib/nessie/cashflow";
import { NessieError } from "@/lib/nessie/errors";
import type { NessieSnapshot } from "@/lib/nessie/types";
import type { AffordabilityResult } from "@/lib/types";
import { NEED, NOW, baselineSnapshot } from "./fixtures";

const analyze = (snapshot: NessieSnapshot, need = NEED) => analyzeSnapshot(snapshot, need, NOW);

const AFFORDABILITY_KEYS: (keyof AffordabilityResult)[] = [
  "avgMonthlyIncome",
  "essentialExpenses",
  "existingDebtPayments",
  "discretionaryBuffer",
  "maxSustainablePayment",
  "recommendedPayment",
  "savingsBalance",
  "cashAvailableForDown",
  "incomeVolatility",
  "summary",
];

describe("analyzeSnapshot — baseline", () => {
  it("computes the hand-worked budget", () => {
    const result = analyze(baselineSnapshot());
    expect(result).toMatchObject({
      avgMonthlyIncome: 3000,
      essentialExpenses: 1230,
      existingDebtPayments: 230,
      discretionaryBuffer: 1540,
      maxSustainablePayment: 310,
      recommendedPayment: 275,
      savingsBalance: 2000,
      cashAvailableForDown: 1400,
      incomeVolatility: "low",
    });
    expect(result.summary).toContain("$3000 in average monthly deposits across 3 accounts");
    expect(result.summary).toContain("$275 or less");
  });

  it("returns exactly the AffordabilityResult keys", () => {
    expect(Object.keys(analyze(baselineSnapshot())).sort()).toEqual([...AFFORDABILITY_KEYS].sort());
  });
});

describe("analyzeSnapshot — data hygiene", () => {
  it("counts a duplicated _id once", () => {
    const snap = baselineSnapshot();
    snap.deposits.push({ ...snap.deposits[0] });
    expect(analyze(snap).avgMonthlyIncome).toBe(3000);
  });

  it("counts a re-seeded duplicate (new id, same content) once", () => {
    const snap = baselineSnapshot();
    snap.deposits.push({ ...snap.deposits[0], _id: "d1-copy" });
    snap.bills.push({ ...snap.bills[0], _id: "b1-copy" });
    const result = analyze(snap);
    expect(result.avgMonthlyIncome).toBe(3000);
    expect(result.essentialExpenses).toBe(1230);
  });

  it("keeps two distinct transactions on the same day", () => {
    const snap = baselineSnapshot();
    snap.deposits.push({ ...snap.deposits[0], _id: "d4", description: "Side gig", amount: 300 });
    expect(analyze(snap).avgMonthlyIncome).toBe(3100);
  });

  it("ignores cancelled records and rewards-medium transactions", () => {
    const snap = baselineSnapshot();
    snap.deposits.push(
      { _id: "dx", accountId: "chk", transaction_date: "2026-10-16", amount: 900, status: "cancelled", medium: "balance" },
      { _id: "dy", accountId: "chk", transaction_date: "2026-10-17", amount: 900, status: "executed", medium: "rewards" },
    );
    snap.bills.push({ _id: "bx", accountId: "chk", status: "canceled", recurring_date: 3, payment_amount: 700 });
    const result = analyze(snap);
    expect(result.avgMonthlyIncome).toBe(3000);
    expect(result.essentialExpenses).toBe(1230);
  });

  it("ignores records outside the 90-day window, future-dated, or with bad dates", () => {
    const snap = baselineSnapshot();
    snap.deposits.push(
      { _id: "old", accountId: "chk", transaction_date: "2026-07-20", amount: 9000, medium: "balance" },
      { _id: "future", accountId: "chk", transaction_date: "2026-11-01", amount: 9000, medium: "balance" },
      { _id: "bad", accountId: "chk", transaction_date: "yesterday", amount: 9000, medium: "balance" },
      { _id: "none", accountId: "chk", amount: 9000, medium: "balance" },
    );
    snap.withdrawals.push({ _id: "w-old", accountId: "chk", transaction_date: "2026-06-01", amount: 3000 });
    const result = analyze(snap);
    expect(result.avgMonthlyIncome).toBe(3000);
    expect(result.essentialExpenses).toBe(1230);
  });

  it("only counts deposits into checking or savings as income", () => {
    const snap = baselineSnapshot();
    snap.deposits.push({ _id: "cc-refund", accountId: "cc", transaction_date: "2026-10-12", amount: 900 });
    expect(analyze(snap).avgMonthlyIncome).toBe(3000);
  });
});

describe("analyzeSnapshot — budget caps", () => {
  it("caps at the buyer's own ceiling", () => {
    const result = analyze(baselineSnapshot(), { ...NEED, maxMonthlyPayment: 250 });
    expect(result.maxSustainablePayment).toBe(250);
    expect(result.recommendedPayment).toBe(220);
  });

  it("caps at 18% of income net of debt", () => {
    expect(analyze(baselineSnapshot(), { ...NEED, maxMonthlyPayment: 2000 }).maxSustainablePayment).toBe(310);
  });

  it("caps at the buffer left after discretionary spending", () => {
    const snap = baselineSnapshot();
    // 1500/mo of purchases leaves round((1540 − 1700) × 0.7) < 150 → floor of 150.
    snap.purchases.push({ _id: "p3", accountId: "cc", purchase_date: "2026-10-11", amount: 4500, merchant_id: "m3" });
    expect(analyze(snap).maxSustainablePayment).toBe(150);
  });

  it("adds approved loans and card minimums to debt", () => {
    const snap = baselineSnapshot();
    snap.loans.push({ _id: "l3", accountId: "sav", status: "approved", monthly_payment: 120, type: "small business" });
    snap.accounts.push({ _id: "cc2", type: "Credit Card", balance: 400 });
    // 200 + 120 loans, 30 + max(25, 8) cards = 375 → round10 = 380.
    expect(analyze(snap).existingDebtPayments).toBe(380);
  });

  it("treats a missing savings account as zero savings", () => {
    const snap = baselineSnapshot();
    snap.accounts = snap.accounts.filter((a) => a.type !== "Savings");
    const result = analyze(snap);
    expect(result.savingsBalance).toBe(0);
    expect(result.cashAvailableForDown).toBe(0);
    expect(result.summary).toContain("across 2 accounts");
  });
});

describe("analyzeSnapshot — insufficient data", () => {
  it("throws insufficient_data when no deposits land in the window", () => {
    const snap = baselineSnapshot();
    snap.deposits = [];
    expect(() => analyze(snap)).toThrowError(NessieError);
    try {
      analyze(snap);
    } catch (err) {
      expect((err as NessieError).kind).toBe("insufficient_data");
    }
  });
});

describe("helpers", () => {
  it("parses Nessie dates as UTC and rejects junk", () => {
    expect(parseNessieDate("2026-10-15")).toBe(Date.UTC(2026, 9, 15));
    expect(parseNessieDate("2026-10-15T08:00:00Z")).toBe(Date.UTC(2026, 9, 15));
    expect(parseNessieDate("10/15/2026")).toBeNull();
    expect(parseNessieDate(undefined)).toBeNull();
  });

  it("classifies income volatility by coefficient of variation", () => {
    expect(incomeVolatility([3000, 3000, 3000])).toBe("low");
    expect(incomeVolatility([3000, 2200, 3600])).toBe("medium");
    expect(incomeVolatility([4000, 500, 3000])).toBe("high");
    expect(incomeVolatility([0, 0, 0])).toBe("high");
  });

  it("dedupes by id first, then fingerprint", () => {
    const rows = [
      { _id: "a", v: 1 },
      { _id: "a", v: 2 },
      { _id: "b", v: 1 },
      { _id: "c", v: 3 },
    ];
    expect(dedupe(rows, (r) => String(r.v)).map((r) => r._id)).toEqual(["a", "c"]);
  });
});
