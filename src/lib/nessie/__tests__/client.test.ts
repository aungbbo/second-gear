import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CUSTOMER_NOT_FOUND,
  NO_ACCOUNTS,
  UNREADABLE_ACCOUNTS,
  describeEndpoint,
  fetchNessieSnapshot,
  getAccountLoans,
  getCustomerAccounts,
  nessieGet,
} from "@/lib/nessie/client";
import { NessieError } from "@/lib/nessie/errors";
import {
  API_KEY,
  BASE_URL,
  CUSTOMER_ID,
  LIVE_CONFIG,
  REAL_FORMAT_ACCOUNT_ID,
  REAL_FORMAT_CUSTOMER_ID,
  REAL_FORMAT_KEY,
  SENSITIVE,
  baselineRoutes,
  expectNoLeaks,
  stubNessieFetch,
} from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function catchError(promise: Promise<unknown>): Promise<NessieError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(NessieError);
    return err as NessieError;
  }
  throw new Error("expected a NessieError");
}

describe("nessieGet", () => {
  it("builds the URL from base URL, path, and key query parameter", async () => {
    const fetchMock = stubNessieFetch({ "/customers/cust1/accounts": [] });
    await nessieGet(LIVE_CONFIG, "/customers/cust1/accounts");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/customers/cust1/accounts?key=${API_KEY}`);
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps 401/403 to auth errors without leaking the key", async () => {
    stubNessieFetch({ "/x": { status: 401 } });
    const err = await catchError(nessieGet(LIVE_CONFIG, "/x"));
    expect(err.kind).toBe("auth");
    expect(err.status).toBe(401);
    expect(err.message).toContain("HTTP 401 from GET /x");
    expectNoLeaks(err.message, [API_KEY, BASE_URL, "key="]);
    expectNoLeaks(err.userMessage, [API_KEY, BASE_URL, "key="]);
  });

  it("retries once on a 5xx and then succeeds", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (++calls === 1 ? new Response("{}", { status: 500 }) : new Response("[1]", { status: 200 }))),
    );
    await expect(nessieGet(LIVE_CONFIG, "/x")).resolves.toEqual([1]);
    expect(calls).toBe(2);
  });

  it("gives up after a second 5xx", async () => {
    const fetchMock = stubNessieFetch({ "/x": { status: 503 } });
    const err = await catchError(nessieGet(LIVE_CONFIG, "/x"));
    expect(err.kind).toBe("upstream");
    expect(err.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once on a network error", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);
    const err = await catchError(nessieGet(LIVE_CONFIG, "/x"));
    expect(err.kind).toBe("upstream");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps an aborted request to a timeout without retrying", async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    vi.stubGlobal("fetch", fetchMock);
    const err = await catchError(nessieGet(LIVE_CONFIG, "/x"));
    expect(err.kind).toBe("timeout");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps a non-JSON body to invalid_response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>oops</html>", { status: 200 })));
    const err = await catchError(nessieGet(LIVE_CONFIG, "/x"));
    expect(err.kind).toBe("invalid_response");
  });
});

describe("list getters", () => {
  it("rejects a non-array body", async () => {
    stubNessieFetch({ [`/customers/${CUSTOMER_ID}/accounts`]: { message: "nope" } });
    const err = await catchError(getCustomerAccounts(LIVE_CONFIG, CUSTOMER_ID));
    expect(err.kind).toBe("invalid_response");
  });

  it("drops malformed records and counts them", async () => {
    stubNessieFetch({
      [`/customers/${CUSTOMER_ID}/accounts`]: [
        { _id: "a1", type: "Checking", balance: 10 },
        { _id: "a2", type: "Checking" },
        { type: "Savings", balance: 5 },
        { _id: "a3", type: "Savings", balance: "12" },
        null,
      ],
    });
    const result = await getCustomerAccounts(LIVE_CONFIG, CUSTOMER_ID);
    expect(result.records.map((a) => a._id)).toEqual(["a1"]);
    expect(result.dropped).toBe(4);
  });

  it("treats a loans 404 as unsupported instead of failing", async () => {
    stubNessieFetch({});
    await expect(getAccountLoans(LIVE_CONFIG, "chk")).resolves.toEqual({ records: [], dropped: 0, supported: false });
  });
});

describe("fetchNessieSnapshot", () => {
  it("collects every resource and tags records with their account", async () => {
    const fetchMock = stubNessieFetch(baselineRoutes());
    const snapshot = await fetchNessieSnapshot(LIVE_CONFIG);
    expect(snapshot.accounts).toHaveLength(3);
    expect(snapshot.deposits).toHaveLength(3);
    expect(snapshot.deposits.every((d) => d.accountId === "chk")).toBe(true);
    expect(snapshot.purchases.map((p) => p.accountId)).toEqual(["cc", "cc"]);
    expect(snapshot.loans).toHaveLength(2);
    expect(snapshot.loansSupported).toBe(true);
    expect(snapshot.dropped).toBe(0);
    // 1 accounts call + 5 resources × 3 accounts, all GET.
    expect(fetchMock).toHaveBeenCalledTimes(16);
  });

  it("reports loans as unsupported when the endpoint is missing", async () => {
    const routes = baselineRoutes();
    for (const path of Object.keys(routes)) if (path.endsWith("/loans")) delete routes[path];
    stubNessieFetch(routes);
    const snapshot = await fetchNessieSnapshot(LIVE_CONFIG);
    expect(snapshot.loansSupported).toBe(false);
    expect(snapshot.loans).toEqual([]);
  });

  it("maps an accounts 404 to not_found with a credentials hint", async () => {
    stubNessieFetch({});
    const err = await catchError(fetchNessieSnapshot(LIVE_CONFIG));
    expect(err.kind).toBe("not_found");
    expect(err.userMessage).toBe(CUSTOMER_NOT_FOUND);
    expect(err.message).toContain("NESSIE_CUSTOMER_ID");
    expectNoLeaks(err.message, SENSITIVE);
  });

  it("does not treat `200 []` from an unknown customer or bad key as a real empty customer", async () => {
    // Nessie answers 200 [] for accounts but 404 for the customer itself.
    const fetchMock = stubNessieFetch({ [`/customers/${CUSTOMER_ID}/accounts`]: [] });
    const err = await catchError(fetchNessieSnapshot(LIVE_CONFIG));
    expect(err.kind).toBe("not_found");
    expect(err.userMessage).toBe(CUSTOMER_NOT_FOUND);
    expect(err.message).toContain("NESSIE_CUSTOMER_ID");
    expect(err.message).toContain("NESSIE_API_KEY");
    expectNoLeaks(err.message, SENSITIVE);
    const paths = fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(paths).toEqual([`/customers/${CUSTOMER_ID}/accounts`, `/customers/${CUSTOMER_ID}`]);
  });

  it("maps a verified customer with no accounts to insufficient_data", async () => {
    stubNessieFetch({
      [`/customers/${CUSTOMER_ID}/accounts`]: [],
      [`/customers/${CUSTOMER_ID}`]: { _id: CUSTOMER_ID, first_name: "Test", last_name: "Buyer" },
    });
    const err = await catchError(fetchNessieSnapshot(LIVE_CONFIG));
    expect(err.kind).toBe("insufficient_data");
    expect(err.userMessage).toBe(NO_ACCOUNTS);
    expect(err.message).toContain("the configured NESSIE_CUSTOMER_ID exists but has no accounts");
    expectNoLeaks(err.message, SENSITIVE);
  });

  it("propagates an upstream failure while verifying an empty customer", async () => {
    stubNessieFetch({
      [`/customers/${CUSTOMER_ID}/accounts`]: [],
      [`/customers/${CUSTOMER_ID}`]: { status: 500 },
    });
    const err = await catchError(fetchNessieSnapshot(LIVE_CONFIG));
    expect(err.kind).toBe("upstream");
  });

  it.each([401, 403])("maps %i during customer verification to auth", async (status) => {
    stubNessieFetch({
      [`/customers/${CUSTOMER_ID}/accounts`]: [],
      [`/customers/${CUSTOMER_ID}`]: { status },
    });
    const err = await catchError(fetchNessieSnapshot(LIVE_CONFIG));
    expect(err.kind).toBe("auth");
    expect(err.status).toBe(status);
    expect(err.message).toContain(`HTTP ${status} from GET /customers/:id`);
    expectNoLeaks(err.message, SENSITIVE);
  });

  it("reports accounts that exist but are unreadable as invalid_response", async () => {
    const fetchMock = stubNessieFetch({
      [`/customers/${CUSTOMER_ID}/accounts`]: [{ _id: "a1" }, { type: "Checking" }],
      [`/customers/${CUSTOMER_ID}`]: { _id: CUSTOMER_ID },
    });
    const err = await catchError(fetchNessieSnapshot(LIVE_CONFIG));
    expect(err.kind).toBe("invalid_response");
    expect(err.userMessage).toBe(UNREADABLE_ACCOUNTS);
    expect(err.message).toContain("2 account record(s) failed validation from GET /customers/:id/accounts");
    expectNoLeaks(err.message, SENSITIVE);
    const paths = fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(paths).toEqual([`/customers/${CUSTOMER_ID}/accounts`]);
  });

  it("proceeds with the readable accounts when only some are malformed", async () => {
    const routes = baselineRoutes();
    const accounts = routes[`/customers/${CUSTOMER_ID}/accounts`] as unknown[];
    routes[`/customers/${CUSTOMER_ID}/accounts`] = [...accounts, { type: "Checking" }];
    stubNessieFetch(routes);
    const snapshot = await fetchNessieSnapshot(LIVE_CONFIG);
    expect(snapshot.accounts).toHaveLength(3);
    expect(snapshot.dropped).toBe(1);
  });

  it("fails the whole snapshot when a sub-resource fails", async () => {
    stubNessieFetch({ ...baselineRoutes(), "/accounts/sav/bills": { status: 401 } });
    const err = await catchError(fetchNessieSnapshot(LIVE_CONFIG));
    expect(err.kind).toBe("auth");
  });
});

describe("diagnostics never carry ids, host, or key", () => {
  const cfg = {
    mode: "live" as const,
    apiKey: REAL_FORMAT_KEY,
    customerId: REAL_FORMAT_CUSTOMER_ID,
    baseUrl: "https://api.nessieisreal.com",
  };
  const SECRETS = [REAL_FORMAT_KEY, REAL_FORMAT_CUSTOMER_ID, REAL_FORMAT_ACCOUNT_ID, cfg.baseUrl, "key="];
  const accountsPath = `/customers/${REAL_FORMAT_CUSTOMER_ID}/accounts`;
  const depositsPath = `/accounts/${REAL_FORMAT_ACCOUNT_ID}/deposits`;
  const oneAccount = [{ _id: REAL_FORMAT_ACCOUNT_ID, type: "Checking", balance: 100 }];

  /** Routes by pathname; a function value may return a Response or throw. */
  function stubFetch(routes: Record<string, () => Response>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const { pathname } = new URL(String(input));
        const handler = routes[pathname];
        return handler ? handler() : Response.json([], { status: 200 });
      }),
    );
  }

  const cases: [string, Record<string, () => Response>, string][] = [
    ["accounts 401", { [accountsPath]: () => new Response("{}", { status: 401 }) }, "auth"],
    ["accounts 404", { [accountsPath]: () => new Response("{}", { status: 404 }) }, "not_found"],
    [
      "empty accounts + customer 404",
      { [`/customers/${REAL_FORMAT_CUSTOMER_ID}`]: () => new Response("{}", { status: 404 }) },
      "not_found",
    ],
    [
      "empty accounts + customer 200",
      { [`/customers/${REAL_FORMAT_CUSTOMER_ID}`]: () => Response.json({ _id: REAL_FORMAT_CUSTOMER_ID }) },
      "insufficient_data",
    ],
    [
      "sub-resource 500 twice",
      { [accountsPath]: () => Response.json(oneAccount), [depositsPath]: () => new Response("{}", { status: 500 }) },
      "upstream",
    ],
    [
      "sub-resource timeout",
      {
        [accountsPath]: () => Response.json(oneAccount),
        [depositsPath]: () => {
          throw new DOMException(`timed out fetching ${cfg.baseUrl}${depositsPath}?key=${REAL_FORMAT_KEY}`, "TimeoutError");
        },
      },
      "timeout",
    ],
    [
      "sub-resource network error",
      {
        [accountsPath]: () => Response.json(oneAccount),
        [depositsPath]: () => {
          throw new TypeError(`fetch failed for ${cfg.baseUrl}${depositsPath}?key=${REAL_FORMAT_KEY}`);
        },
      },
      "upstream",
    ],
    [
      "sub-resource non-JSON body",
      { [accountsPath]: () => Response.json(oneAccount), [depositsPath]: () => new Response("<html>") },
      "invalid_response",
    ],
  ];

  it.each(cases)("%s", async (_label, routes, kind) => {
    stubFetch(routes);
    const err = await catchError(fetchNessieSnapshot(cfg));
    expect(err.kind).toBe(kind);
    expectNoLeaks(err.message, SECRETS);
    expectNoLeaks(err.userMessage, SECRETS);
    expectNoLeaks(String(err.stack), SECRETS);
  });
});

describe("describeEndpoint", () => {
  it.each([
    ["/customers/abc/accounts", "GET /customers/:id/accounts"],
    ["/accounts/x/deposits", "GET /accounts/:id/deposits"],
    ["/customers/abc", "GET /customers/:id"],
    ["/accounts/x/loans?key=secret", "GET /accounts/:id/loans"],
  ])("%s → %s", (path, expected) => {
    expect(describeEndpoint(path)).toBe(expected);
  });
});
