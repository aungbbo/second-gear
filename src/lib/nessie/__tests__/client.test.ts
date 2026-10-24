import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNessieSnapshot, getAccountLoans, getCustomerAccounts, maskId, nessieGet } from "@/lib/nessie/client";
import { NessieError } from "@/lib/nessie/errors";
import { API_KEY, BASE_URL, CUSTOMER_ID, LIVE_CONFIG, baselineRoutes, stubNessieFetch } from "./fixtures";

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
    expect(err.message).not.toContain(API_KEY);
    expect(err.message).toContain("key=***");
    expect(err.userMessage).not.toContain(API_KEY);
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
    expect(err.userMessage).toBe("No accounts for this Nessie customer.");
    expect(err.message).toContain("NESSIE_CUSTOMER_ID");
    expect(err.message).toContain(CUSTOMER_ID);
    expect(err.message).not.toContain(API_KEY);
  });

  it("does not treat `200 []` from an unknown customer or bad key as a real empty customer", async () => {
    // Nessie answers 200 [] for accounts but 404 for the customer itself.
    const fetchMock = stubNessieFetch({ [`/customers/${CUSTOMER_ID}/accounts`]: [] });
    const err = await catchError(fetchNessieSnapshot(LIVE_CONFIG));
    expect(err.kind).toBe("not_found");
    expect(err.userMessage).toBe("We couldn't find that bank customer.");
    expect(err.message).toContain("NESSIE_CUSTOMER_ID");
    expect(err.message).toContain("NESSIE_API_KEY");
    expect(err.message).not.toContain(API_KEY);
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
    expect(err.userMessage).toBe("No accounts for this Nessie customer.");
    expect(err.message).toContain(`customer ${CUSTOMER_ID} exists but has no accounts`);
    expect(err.message).not.toContain(API_KEY);
  });

  it("propagates an upstream failure while verifying an empty customer", async () => {
    stubNessieFetch({
      [`/customers/${CUSTOMER_ID}/accounts`]: [],
      [`/customers/${CUSTOMER_ID}`]: { status: 500 },
    });
    const err = await catchError(fetchNessieSnapshot(LIVE_CONFIG));
    expect(err.kind).toBe("upstream");
  });

  it("masks long customer ids in diagnostics", async () => {
    const longId = "abcdef12-3456-4789-8abc-def012345678";
    stubNessieFetch({ [`/customers/${longId}/accounts`]: [] });
    const err = await catchError(fetchNessieSnapshot({ ...LIVE_CONFIG, customerId: longId }));
    expect(err.message).toContain("customer abcdef12…");
    expect(err.message).not.toContain(longId);
    expect(maskId("short")).toBe("short");
  });

  it("fails the whole snapshot when a sub-resource fails", async () => {
    stubNessieFetch({ ...baselineRoutes(), "/accounts/sav/bills": { status: 401 } });
    const err = await catchError(fetchNessieSnapshot(LIVE_CONFIG));
    expect(err.kind).toBe("auth");
  });
});
