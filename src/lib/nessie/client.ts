import type { NessieConfig } from "@/lib/nessie/config";
import { NessieError } from "@/lib/nessie/errors";
import type {
  NessieAccount,
  NessieBill,
  NessieDeposit,
  NessieLoan,
  NessiePurchase,
  NessieSnapshot,
  NessieWithdrawal,
  WithAccount,
} from "@/lib/nessie/types";

export type LiveNessieConfig = Extract<NessieConfig, { mode: "live" }>;

export const REQUEST_TIMEOUT_MS = 8000;
export const RETRY_DELAY_MS = 300;

const UNAVAILABLE = "Couldn't reach the bank data service. Try again in a minute.";
export const CUSTOMER_NOT_FOUND = "We couldn't find that bank customer.";
export const NO_ACCOUNTS = "No accounts for this Nessie customer.";
export const UNREADABLE_ACCOUNTS = "The bank returned account data we couldn't read.";
export const LOANS_UNAVAILABLE = "We couldn't load your loan details, so we can't estimate a safe payment yet.";

/** "GET /customers/:id/accounts" — the route shape, never the ids, host, or key. */
export function describeEndpoint(path: string): string {
  return `GET ${path.split("?")[0].replace(/\/(customers|accounts|merchants)\/[^/]+/g, "/$1/:id")}`;
}

/** Records missing an id or a finite amount field are dropped, not trusted. */
interface ListResult<T> {
  records: T[];
  dropped: number;
}

function hasNumber(record: Record<string, unknown>, field: string): boolean {
  return typeof record[field] === "number" && Number.isFinite(record[field]);
}

function validateList<T>(body: unknown, amountField: string, endpoint: string): ListResult<T> {
  if (!Array.isArray(body)) {
    throw new NessieError("invalid_response", UNAVAILABLE, {
      detail: `expected an array from ${endpoint}`,
    });
  }
  const records: T[] = [];
  let dropped = 0;
  for (const item of body) {
    const record = item as Record<string, unknown>;
    if (record && typeof record === "object" && typeof record._id === "string" && hasNumber(record, amountField)) {
      records.push(record as T);
    } else {
      dropped++;
    }
  }
  return { records, dropped };
}

async function requestOnce(url: string, endpoint: string): Promise<Response> {
  try {
    return await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    // The underlying error can echo the URL, so it is never attached or chained.
    const name = (err as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new NessieError("timeout", UNAVAILABLE, { detail: `timed out: ${endpoint}` });
    }
    throw new NessieError("upstream", UNAVAILABLE, { detail: `network error: ${endpoint}` });
  }
}

/**
 * Read-only GET against the Nessie sandbox. Network errors and 5xx get one
 * retry (GETs are idempotent); everything else fails fast.
 */
export async function nessieGet(cfg: LiveNessieConfig, path: string): Promise<unknown> {
  const url = `${cfg.baseUrl}${path}?key=${encodeURIComponent(cfg.apiKey)}`;
  const endpoint = describeEndpoint(path);

  let response: Response;
  try {
    response = await requestOnce(url, endpoint);
    if (response.status >= 500) throw new NessieError("upstream", UNAVAILABLE, { status: response.status });
  } catch (err) {
    if (!(err instanceof NessieError) || err.kind !== "upstream") throw err;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    response = await requestOnce(url, endpoint);
  }

  if (response.status === 401 || response.status === 403) {
    throw new NessieError("auth", "The bank data service rejected our credentials.", {
      status: response.status,
      detail: `HTTP ${response.status} from ${endpoint}`,
    });
  }
  if (response.status === 404) {
    throw new NessieError("not_found", CUSTOMER_NOT_FOUND, {
      status: 404,
      detail: `HTTP 404 from ${endpoint}`,
    });
  }
  if (!response.ok) {
    throw new NessieError("upstream", UNAVAILABLE, {
      status: response.status,
      detail: `HTTP ${response.status} from ${endpoint}`,
    });
  }

  try {
    return await response.json();
  } catch {
    throw new NessieError("invalid_response", UNAVAILABLE, { detail: `non-JSON body from ${endpoint}` });
  }
}

async function getList<T>(cfg: LiveNessieConfig, path: string, amountField: string): Promise<ListResult<T>> {
  const body = await nessieGet(cfg, path);
  return validateList<T>(body, amountField, describeEndpoint(path));
}

export function getCustomerAccounts(cfg: LiveNessieConfig, customerId: string) {
  return getList<NessieAccount>(cfg, `/customers/${encodeURIComponent(customerId)}/accounts`, "balance");
}

export function getAccountDeposits(cfg: LiveNessieConfig, accountId: string) {
  return getList<NessieDeposit>(cfg, `/accounts/${encodeURIComponent(accountId)}/deposits`, "amount");
}

export function getAccountWithdrawals(cfg: LiveNessieConfig, accountId: string) {
  return getList<NessieWithdrawal>(cfg, `/accounts/${encodeURIComponent(accountId)}/withdrawals`, "amount");
}

export function getAccountPurchases(cfg: LiveNessieConfig, accountId: string) {
  return getList<NessiePurchase>(cfg, `/accounts/${encodeURIComponent(accountId)}/purchases`, "amount");
}

export function getAccountBills(cfg: LiveNessieConfig, accountId: string) {
  return getList<NessieBill>(cfg, `/accounts/${encodeURIComponent(accountId)}/bills`, "payment_amount");
}

/**
 * Loans are part of the documented API, so any failure — a 404 included —
 * is an error. Only a successful empty list means "no loans"; assuming zero
 * debt on a failed read would quietly inflate the safe payment.
 */
export async function getAccountLoans(cfg: LiveNessieConfig, accountId: string): Promise<ListResult<NessieLoan>> {
  try {
    return await getList<NessieLoan>(cfg, `/accounts/${encodeURIComponent(accountId)}/loans`, "monthly_payment");
  } catch (err) {
    if (err instanceof NessieError && err.kind === "not_found") {
      throw new NessieError("upstream", LOANS_UNAVAILABLE, {
        status: 404,
        detail: `HTTP 404 from ${describeEndpoint("/accounts/:id/loans")} — refusing to assume zero debt`,
      });
    }
    throw err;
  }
}

function tag<T>(records: T[], accountId: string): WithAccount<T>[] {
  return records.map((record) => ({ ...record, accountId }));
}

// Hints name the settings, never their values.
const UNVERIFIED_CUSTOMER_HINT =
  "Nessie returns an empty list for an unknown NESSIE_CUSTOMER_ID or an invalid NESSIE_API_KEY — verify both";
const EMPTY_CUSTOMER_HINT = "the configured NESSIE_CUSTOMER_ID exists but has no accounts — seed it in the sandbox";

/**
 * An empty account list is ambiguous: Nessie answers `200 []` for a real
 * customer with no accounts, an unknown customer id, and an invalid key
 * alike. `GET /customers/{id}` tells them apart (404 for the last two).
 */
async function explainEmptyAccounts(cfg: LiveNessieConfig): Promise<NessieError> {
  try {
    await nessieGet(cfg, `/customers/${encodeURIComponent(cfg.customerId)}`);
  } catch (err) {
    if (err instanceof NessieError && err.kind === "not_found") {
      return new NessieError("not_found", CUSTOMER_NOT_FOUND, { status: 404, detail: UNVERIFIED_CUSTOMER_HINT });
    }
    throw err;
  }
  return new NessieError("insufficient_data", NO_ACCOUNTS, { detail: EMPTY_CUSTOMER_HINT });
}

/** Pulls every read-only resource the cash-flow analyzer needs. */
export async function fetchNessieSnapshot(cfg: LiveNessieConfig): Promise<NessieSnapshot> {
  let accountsResult: ListResult<NessieAccount>;
  try {
    accountsResult = await getCustomerAccounts(cfg, cfg.customerId);
  } catch (err) {
    if (err instanceof NessieError && err.kind === "not_found") {
      throw new NessieError("not_found", CUSTOMER_NOT_FOUND, { status: 404, detail: UNVERIFIED_CUSTOMER_HINT });
    }
    throw err;
  }

  const accounts = accountsResult.records;
  if (accounts.length === 0 && accountsResult.dropped > 0) {
    // Accounts exist but none passed validation — not the same as having none.
    throw new NessieError("invalid_response", UNREADABLE_ACCOUNTS, {
      detail: `${accountsResult.dropped} account record(s) failed validation from ${describeEndpoint("/customers/:id/accounts")}`,
    });
  }
  if (accounts.length === 0) {
    throw await explainEmptyAccounts(cfg);
  }

  const perAccount = await Promise.all(
    accounts.map(async (account) => {
      const [deposits, withdrawals, purchases, bills, loans] = await Promise.all([
        getAccountDeposits(cfg, account._id),
        getAccountWithdrawals(cfg, account._id),
        getAccountPurchases(cfg, account._id),
        getAccountBills(cfg, account._id),
        getAccountLoans(cfg, account._id),
      ]);
      return { accountId: account._id, deposits, withdrawals, purchases, bills, loans };
    }),
  );

  const snapshot: NessieSnapshot = {
    accounts,
    deposits: [],
    withdrawals: [],
    purchases: [],
    bills: [],
    loans: [],
    dropped: accountsResult.dropped,
  };

  for (const entry of perAccount) {
    snapshot.deposits.push(...tag(entry.deposits.records, entry.accountId));
    snapshot.withdrawals.push(...tag(entry.withdrawals.records, entry.accountId));
    snapshot.purchases.push(...tag(entry.purchases.records, entry.accountId));
    snapshot.bills.push(...tag(entry.bills.records, entry.accountId));
    snapshot.loans.push(...tag(entry.loans.records, entry.accountId));
    snapshot.dropped +=
      entry.deposits.dropped +
      entry.withdrawals.dropped +
      entry.purchases.dropped +
      entry.bills.dropped +
      entry.loans.dropped;
  }

  return snapshot;
}
