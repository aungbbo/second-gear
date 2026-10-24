import type { NessieConfig } from "@/lib/nessie/config";
import { NessieError, redactKey } from "@/lib/nessie/errors";
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

/** Records missing an id or a finite amount field are dropped, not trusted. */
interface ListResult<T> {
  records: T[];
  dropped: number;
}

function hasNumber(record: Record<string, unknown>, field: string): boolean {
  return typeof record[field] === "number" && Number.isFinite(record[field]);
}

function validateList<T>(body: unknown, amountField: string, url: string): ListResult<T> {
  if (!Array.isArray(body)) {
    throw new NessieError("invalid_response", UNAVAILABLE, {
      detail: `expected an array from ${redactKey(url)}`,
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

async function requestOnce(url: string): Promise<Response> {
  try {
    return await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new NessieError("timeout", UNAVAILABLE, { detail: `timed out: ${redactKey(url)}` });
    }
    throw new NessieError("upstream", UNAVAILABLE, { detail: `network error: ${redactKey(url)}` });
  }
}

/**
 * Read-only GET against the Nessie sandbox. Network errors and 5xx get one
 * retry (GETs are idempotent); everything else fails fast.
 */
export async function nessieGet(cfg: LiveNessieConfig, path: string): Promise<unknown> {
  const url = `${cfg.baseUrl}${path}?key=${encodeURIComponent(cfg.apiKey)}`;

  let response: Response;
  try {
    response = await requestOnce(url);
    if (response.status >= 500) throw new NessieError("upstream", UNAVAILABLE, { status: response.status });
  } catch (err) {
    if (!(err instanceof NessieError) || err.kind !== "upstream") throw err;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    response = await requestOnce(url);
  }

  if (response.status === 401 || response.status === 403) {
    throw new NessieError("auth", "The bank data service rejected our credentials.", {
      status: response.status,
      detail: redactKey(url),
    });
  }
  if (response.status === 404) {
    throw new NessieError("not_found", "We couldn't find that bank customer.", {
      status: 404,
      detail: redactKey(url),
    });
  }
  if (!response.ok) {
    throw new NessieError("upstream", UNAVAILABLE, {
      status: response.status,
      detail: `HTTP ${response.status} from ${redactKey(url)}`,
    });
  }

  try {
    return await response.json();
  } catch {
    throw new NessieError("invalid_response", UNAVAILABLE, { detail: `non-JSON body from ${redactKey(url)}` });
  }
}

async function getList<T>(cfg: LiveNessieConfig, path: string, amountField: string): Promise<ListResult<T>> {
  const body = await nessieGet(cfg, path);
  return validateList<T>(body, amountField, `${cfg.baseUrl}${path}`);
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
 * Loans are only documented in the iOS SDK, so a 404 here means the
 * endpoint isn't available rather than that the customer is missing.
 */
export async function getAccountLoans(
  cfg: LiveNessieConfig,
  accountId: string,
): Promise<ListResult<NessieLoan> & { supported: boolean }> {
  try {
    const result = await getList<NessieLoan>(cfg, `/accounts/${encodeURIComponent(accountId)}/loans`, "monthly_payment");
    return { ...result, supported: true };
  } catch (err) {
    if (err instanceof NessieError && err.kind === "not_found") return { records: [], dropped: 0, supported: false };
    throw err;
  }
}

function tag<T>(records: T[], accountId: string): WithAccount<T>[] {
  return records.map((record) => ({ ...record, accountId }));
}

/** Pulls every read-only resource the cash-flow analyzer needs. */
export async function fetchNessieSnapshot(cfg: LiveNessieConfig): Promise<NessieSnapshot> {
  let accountsResult: ListResult<NessieAccount>;
  try {
    accountsResult = await getCustomerAccounts(cfg, cfg.customerId);
  } catch (err) {
    if (err instanceof NessieError && err.kind === "not_found") {
      throw new NessieError("not_found", "No accounts for this Nessie customer.", { status: 404 });
    }
    throw err;
  }

  const accounts = accountsResult.records;
  if (accounts.length === 0) {
    throw new NessieError("insufficient_data", "No accounts for this Nessie customer.");
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
    loansSupported: true,
    dropped: accountsResult.dropped,
  };

  for (const entry of perAccount) {
    snapshot.deposits.push(...tag(entry.deposits.records, entry.accountId));
    snapshot.withdrawals.push(...tag(entry.withdrawals.records, entry.accountId));
    snapshot.purchases.push(...tag(entry.purchases.records, entry.accountId));
    snapshot.bills.push(...tag(entry.bills.records, entry.accountId));
    snapshot.loans.push(...tag(entry.loans.records, entry.accountId));
    snapshot.loansSupported &&= entry.loans.supported;
    snapshot.dropped +=
      entry.deposits.dropped +
      entry.withdrawals.dropped +
      entry.purchases.dropped +
      entry.bills.dropped +
      entry.loans.dropped;
  }

  return snapshot;
}
