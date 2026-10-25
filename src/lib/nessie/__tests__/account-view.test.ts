import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAccountsView, withPostedActivity } from "@/lib/nessie/account-view";
import { postDeposit, postWithdrawal, readAccountsView } from "@/lib/nessie/actions";
import { NessieError } from "@/lib/nessie/errors";
import { __resetMockNessieWritesForTests } from "@/lib/nessie/mock-store";
import type { NessieSnapshot } from "@/lib/nessie/types";
import { API_KEY, BASE_URL, CUSTOMER_ID, baselineRoutes } from "./fixtures";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  __resetMockNessieWritesForTests();
});

function snapshot(): NessieSnapshot {
  return {
    accounts: [
      { _id: "chk", type: "Checking", nickname: "Everyday", balance: 1850 },
      { _id: "sav", type: "Savings", nickname: "Rainy day", balance: 2400 },
      { _id: "cc", type: "Credit Card", nickname: "Card", balance: 1800 },
    ],
    deposits: [
      { _id: "d1", accountId: "chk", amount: 1650, status: "completed", description: "sg-seed: Payroll (2026-10-10)" },
      { _id: "d2", accountId: "chk", amount: 1000, status: "completed", description: "payroll" },
      { _id: "d3", accountId: "chk", amount: 75.5, status: "completed", description: "Refund" },
      { _id: "d4", accountId: "chk", amount: 999, status: "cancelled", description: "Bounced" },
      { _id: "d5", accountId: "cc", amount: 300, status: "completed", description: "Card payment" },
    ],
    withdrawals: [
      { _id: "w1", accountId: "chk", amount: 120, status: "completed", description: "sg-seed: ATM cash (2026-10-16)" },
      { _id: "w2", accountId: "chk", amount: 40.25, status: "completed", description: "Gas" },
    ],
    purchases: [{ _id: "p1", accountId: "cc", amount: 50, status: "completed", description: "Diner" }],
    transfers: [],
    bills: [],
    loans: [],
    dropped: 0,
  };
}

describe("withPostedActivity", () => {
  it("applies only records posted after opening, skipping seeded and cancelled ones", () => {
    const balances = Object.fromEntries(withPostedActivity(snapshot()).accounts.map((a) => [a._id, a.balance]));
    expect(balances).toEqual({
      chk: 1850 + 1000 + 75.5 - 40.25,
      sav: 2400,
      cc: 1800 - 300 + 50,
    });
  });

  it("leaves a fully seeded snapshot unchanged", () => {
    const seededOnly = snapshot();
    seededOnly.deposits = seededOnly.deposits.slice(0, 1);
    seededOnly.withdrawals = seededOnly.withdrawals.slice(0, 1);
    seededOnly.purchases = [];
    expect(withPostedActivity(seededOnly).accounts).toEqual(seededOnly.accounts);
  });
});

describe("buildAccountsView totals", () => {
  it("counts checking and savings as cash, and reports the card as owed", () => {
    const view = buildAccountsView(snapshot(), "live");
    expect(view.totalBalance).toBe(1850 + 2400);
    expect(view.creditCardBalance).toBe(1800);
  });
});

describe("mock-mode writes", () => {
  it("adds a deposit to the total balance", async () => {
    vi.stubEnv("NESSIE_MODE", "mock");
    const before = await readAccountsView();
    const after = await postDeposit({ amount: 125, description: "Gift" });
    expect(after.totalBalance).toBe(before.totalBalance + 125);
    expect(after.transactions[0]).toMatchObject({ description: "Gift", amount: 125, direction: "in" });
  });

  it("refuses cents on deposits and withdrawals, which Nessie stores as integers", async () => {
    vi.stubEnv("NESSIE_MODE", "mock");
    await expect(postDeposit({ amount: 12.5, description: "x" })).rejects.toThrow(/whole dollars/);
    await expect(postWithdrawal({ amount: 0.99, description: "x" })).rejects.toThrow(/whole dollars/);
  });

  it("refuses a withdrawal larger than the checking balance", async () => {
    vi.stubEnv("NESSIE_MODE", "mock");
    const before = await readAccountsView();
    const checking = before.accounts.find((a) => a.type === "Checking")!;
    await expect(postWithdrawal({ amount: checking.balance + 1, description: "Too much" })).rejects.toMatchObject({
      kind: "insufficient_data",
    });
    expect((await readAccountsView()).totalBalance).toBe(before.totalBalance);
  });
});

describe("live-mode deposit", () => {
  function stubLiveSandbox() {
    vi.stubEnv("NESSIE_MODE", "live");
    vi.stubEnv("NESSIE_API_KEY", API_KEY);
    vi.stubEnv("NESSIE_CUSTOMER_ID", CUSTOMER_ID);
    vi.stubEnv("NESSIE_BASE_URL", BASE_URL);
    const routes = baselineRoutes();
    const posted: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      if (method === "POST" && url.pathname === "/accounts/chk/deposits") {
        const body = JSON.parse(String(init?.body));
        posted.push({ ...body, _id: `new-${posted.length}` });
        return new Response(JSON.stringify({ code: 201, objectCreated: body }), { status: 201 });
      }
      if (method !== "GET") return new Response("{}", { status: 405 });
      // Like the real sandbox: a new deposit shows in the ledger, the stored balance never moves.
      const reply =
        url.pathname === "/accounts/chk/deposits"
          ? [...(routes[url.pathname] as unknown[]), ...posted]
          : routes[url.pathname];
      if (reply === undefined) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify(reply), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("posts the deposit once and reflects it in the balance without any PUT", async () => {
    const fetchMock = stubLiveSandbox();
    const before = await readAccountsView();
    const after = await postDeposit({ amount: 250, description: "sg-seed: sneaky" });

    expect(after.totalBalance).toBe(before.totalBalance + 250);
    const methods = fetchMock.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.method ?? "GET");
    expect(methods.filter((m) => m === "POST")).toHaveLength(1);
    expect(methods).not.toContain("PUT");
    const [, init] = fetchMock.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse(String((init as RequestInit).body)).description).toBe("sneaky");
  });

  it("rejects an overdraft before posting anything", async () => {
    const fetchMock = stubLiveSandbox();
    const err = await postWithdrawal({ amount: 20000, description: "Too much" }).catch((e) => e);
    expect(err).toBeInstanceOf(NessieError);
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });
});
