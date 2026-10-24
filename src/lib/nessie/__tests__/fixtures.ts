import { vi } from "vitest";
import type { NessieSnapshot } from "@/lib/nessie/types";
import type { BuyerNeed } from "@/lib/types";

export const NOW = new Date("2026-10-24T12:00:00Z");
export const BASE_URL = "http://nessie.test";
export const API_KEY = "secret-key-123";
export const CUSTOMER_ID = "cust1";

export const LIVE_CONFIG = { mode: "live" as const, apiKey: API_KEY, customerId: CUSTOMER_ID, baseUrl: BASE_URL };

export const NEED: BuyerNeed = {
  description: "A reliable commuter",
  maxMonthlyPayment: 400,
  timeframeWeeks: 4,
  downPayment: 0,
  zip: "43215",
};

/**
 * Baseline customer, worked out by hand:
 *   income      3000/mo  (3 × 3000 deposits, one per 30-day bucket)
 *   essentials  1230/mo  (1100 recurring rent + 90/3 one-off bill + 300/3 withdrawals)
 *   debt         230/mo  (200 approved loan + max(25, 2% × 1500) card minimum)
 *   purchases    200/mo  (600 / 3)
 *   → buffer 1540, safe ceiling round5(540 − 230) = 310, buffer cap round(1340 × 0.7) = 938
 *   → max sustainable min(400, 310, 938) = 310, recommended round5(272.8) = 275
 */
export function baselineSnapshot(): NessieSnapshot {
  return {
    accounts: [
      { _id: "chk", type: "Checking", nickname: "Everyday", balance: 1200 },
      { _id: "sav", type: "Savings", nickname: "Rainy day", balance: 2000 },
      { _id: "cc", type: "Credit Card", nickname: "Card", balance: 1500 },
    ],
    deposits: [
      { _id: "d1", accountId: "chk", transaction_date: "2026-10-15", amount: 3000, description: "Payroll", status: "executed", medium: "balance" },
      { _id: "d2", accountId: "chk", transaction_date: "2026-09-15", amount: 3000, description: "Payroll", status: "executed", medium: "balance" },
      { _id: "d3", accountId: "chk", transaction_date: "2026-08-15", amount: 3000, description: "Payroll", status: "executed", medium: "balance" },
    ],
    withdrawals: [
      { _id: "w1", accountId: "chk", transaction_date: "2026-10-01", amount: 300, description: "ATM", status: "executed", medium: "balance" },
    ],
    purchases: [
      { _id: "p1", accountId: "cc", purchase_date: "2026-10-10", amount: 400, description: "Groceries", merchant_id: "m1", medium: "balance" },
      { _id: "p2", accountId: "cc", purchase_date: "2026-09-10", amount: 200, description: "Dinner", merchant_id: "m2", medium: "balance" },
    ],
    bills: [
      { _id: "b1", accountId: "chk", status: "recurring", payee: "Landlord", nickname: "Rent", recurring_date: 1, payment_amount: 1100 },
      { _id: "b2", accountId: "chk", status: "completed", payee: "Power Co", nickname: "Electric", payment_date: "2026-10-05", payment_amount: 90 },
    ],
    loans: [
      { _id: "l1", accountId: "chk", type: "auto", status: "approved", monthly_payment: 200, amount: 8000, creation_date: "2025-01-01" },
      { _id: "l2", accountId: "chk", type: "home", status: "declined", monthly_payment: 500, amount: 90000, creation_date: "2025-02-01" },
    ],
    loansSupported: true,
    dropped: 0,
  };
}

/** Raw API payloads for the baseline snapshot, keyed by request path. */
export function baselineRoutes(): Record<string, unknown> {
  const snap = baselineSnapshot();
  const strip = <T extends { accountId: string }>(records: T[], accountId: string) =>
    records
      .filter((r) => r.accountId === accountId)
      .map((r) => {
        const rest: Partial<T> = { ...r };
        delete rest.accountId;
        return rest;
      });

  const routes: Record<string, unknown> = { [`/customers/${CUSTOMER_ID}/accounts`]: snap.accounts };
  for (const { _id } of snap.accounts) {
    routes[`/accounts/${_id}/deposits`] = strip(snap.deposits, _id);
    routes[`/accounts/${_id}/withdrawals`] = strip(snap.withdrawals, _id);
    routes[`/accounts/${_id}/purchases`] = strip(snap.purchases, _id);
    routes[`/accounts/${_id}/bills`] = strip(snap.bills, _id);
    routes[`/accounts/${_id}/loans`] = strip(snap.loans, _id);
  }
  return routes;
}

type RouteValue = unknown | { status: number; body?: unknown };

const isStatusReply = (value: unknown): value is { status: number; body?: unknown } =>
  !!value && typeof value === "object" && !Array.isArray(value) && "status" in value;

/**
 * Stubs global fetch with a path → JSON table. Unknown paths answer 404.
 * Returns the mock so tests can inspect calls.
 */
export function stubNessieFetch(routes: Record<string, RouteValue>) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const reply = routes[url.pathname];
    if (reply === undefined) return new Response(JSON.stringify({ code: 404, message: "Not found" }), { status: 404 });
    if (isStatusReply(reply)) return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
