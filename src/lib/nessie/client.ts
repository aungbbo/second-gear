import type { NessieConfig } from "@/lib/nessie/config";
import { NessieError } from "@/lib/nessie/errors";
import type {
  NessieAccount,
  NessieBill,
  NessieDeposit,
  NessieLoan,
  NessiePurchase,
  NessieSnapshot,
  NessieTransfer,
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

/**
 * Transfers diverge from every other resource in two ways: the sandbox
 * answers 404 "No transfers found for this account" instead of `200 []`
 * when an account has none yet (that 404 means "empty", not "missing"),
 * and each listed record is keyed `id`, not `_id` like everything else
 * (verified 2026-10-24) — without normalizing it, validateList drops every
 * transfer as unidentifiable.
 */
export async function getAccountTransfers(cfg: LiveNessieConfig, accountId: string): Promise<ListResult<NessieTransfer>> {
  const path = `/accounts/${encodeURIComponent(accountId)}/transfers`;
  let body: unknown;
  try {
    body = await nessieGet(cfg, path);
  } catch (err) {
    if (err instanceof NessieError && err.kind === "not_found") return { records: [], dropped: 0 };
    throw err;
  }
  const normalized = Array.isArray(body)
    ? body.map((item) => {
        const record = item as Record<string, unknown>;
        return typeof record._id === "string" ? record : { ...record, _id: record.id };
      })
    : body;
  return validateList<NessieTransfer>(normalized, "amount", describeEndpoint(path));
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

// --- Writes -----------------------------------------------------------
//
// Unlike every read above, these create real records in the live sandbox.
// Never retried: a retry on a GET is safe (idempotent), but retrying a POST
// after a timeout could create the record twice. ASCII-only, status always
// set explicitly — the live sandbox rejects a non-ASCII payload or a
// transaction create missing `status`, lessons learned the hard way by
// scripts/nessie-seed.mjs (see docs/nessie-sandbox.md).

const toAscii = (text: string) => text.replace(/[^\x20-\x7e]/g, "").trim();

async function nessiePostOnce(cfg: LiveNessieConfig, path: string, body: Record<string, unknown>): Promise<Response> {
  const url = `${cfg.baseUrl}${path}?key=${encodeURIComponent(cfg.apiKey)}`;
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new NessieError("timeout", UNAVAILABLE, { detail: `timed out: POST ${path}` });
    }
    throw new NessieError("upstream", UNAVAILABLE, { detail: `network error: POST ${path}` });
  }
}

async function nessiePost(cfg: LiveNessieConfig, path: string, body: Record<string, unknown>): Promise<void> {
  const endpoint = `POST ${path.replace(/\/(customers|accounts|merchants)\/[^/]+/g, "/$1/:id")}`;
  const response = await nessiePostOnce(cfg, path, body);
  if (response.status === 401 || response.status === 403) {
    throw new NessieError("auth", "The bank data service rejected our credentials.", {
      status: response.status,
      detail: `HTTP ${response.status} from ${endpoint}`,
    });
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new NessieError("upstream", UNAVAILABLE, {
      status: response.status,
      detail: `HTTP ${response.status} from ${endpoint}${text ? `: ${text.slice(0, 200)}` : ""}`,
    });
  }
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Most recent due date on or before today for a bill due on `dayOfMonth` (1-28). */
export function mostRecentDueDate(dayOfMonth: number, now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const target = d >= dayOfMonth ? new Date(Date.UTC(y, m, dayOfMonth)) : new Date(Date.UTC(y, m - 1, dayOfMonth));
  return target.toISOString().slice(0, 10);
}

export async function createDeposit(
  cfg: LiveNessieConfig,
  accountId: string,
  amount: number,
  description: string,
): Promise<void> {
  await nessiePost(cfg, `/accounts/${encodeURIComponent(accountId)}/deposits`, {
    medium: "balance",
    status: "completed",
    transaction_date: todayIso(),
    amount,
    description: toAscii(description).slice(0, 100) || "Deposit",
  });
}

export async function createWithdrawal(
  cfg: LiveNessieConfig,
  accountId: string,
  amount: number,
  description: string,
): Promise<void> {
  await nessiePost(cfg, `/accounts/${encodeURIComponent(accountId)}/withdrawals`, {
    medium: "balance",
    status: "completed",
    transaction_date: todayIso(),
    amount,
    description: toAscii(description).slice(0, 100) || "Withdrawal",
  });
}

/**
 * `toAccountId` is accepted for callers' clarity but never sent: the live
 * sandbox's TransferCreate schema has no destination field at all — every
 * name tried (`payee_id`, `transfer_to_id`, `toAccountId`, even as a query
 * param) is rejected as an extra field or silently dropped (verified
 * 2026-10-24, see docs/nessie-sandbox.md). `withPostedActivity` instead
 * credits the account's one savings account by convention.
 */
export async function createTransfer(
  cfg: LiveNessieConfig,
  fromAccountId: string,
  toAccountId: string,
  amount: number,
  description: string,
): Promise<void> {
  void toAccountId;
  await nessiePost(cfg, `/accounts/${encodeURIComponent(fromAccountId)}/transfers`, {
    status: "completed",
    transaction_date: todayIso(),
    amount,
    description: toAscii(description).slice(0, 100) || "Transfer",
  });
}

export async function createBill(
  cfg: LiveNessieConfig,
  accountId: string,
  amount: number,
  nickname: string,
  payee: string,
  dayOfMonth: number,
): Promise<void> {
  await nessiePost(cfg, `/accounts/${encodeURIComponent(accountId)}/bills`, {
    status: "recurring",
    nickname: toAscii(nickname).slice(0, 60) || "Bill",
    payee: toAscii(payee).slice(0, 60) || "Payee",
    payment_amount: amount,
    recurring_date: dayOfMonth,
    payment_date: mostRecentDueDate(dayOfMonth),
  });
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
      const [deposits, withdrawals, purchases, transfers, bills, loans] = await Promise.all([
        getAccountDeposits(cfg, account._id),
        getAccountWithdrawals(cfg, account._id),
        getAccountPurchases(cfg, account._id),
        getAccountTransfers(cfg, account._id),
        getAccountBills(cfg, account._id),
        getAccountLoans(cfg, account._id),
      ]);
      return { accountId: account._id, deposits, withdrawals, purchases, transfers, bills, loans };
    }),
  );

  const snapshot: NessieSnapshot = {
    accounts,
    deposits: [],
    withdrawals: [],
    purchases: [],
    transfers: [],
    bills: [],
    loans: [],
    dropped: accountsResult.dropped,
  };

  for (const entry of perAccount) {
    snapshot.deposits.push(...tag(entry.deposits.records, entry.accountId));
    snapshot.withdrawals.push(...tag(entry.withdrawals.records, entry.accountId));
    snapshot.purchases.push(...tag(entry.purchases.records, entry.accountId));
    snapshot.transfers.push(...tag(entry.transfers.records, entry.accountId));
    snapshot.bills.push(...tag(entry.bills.records, entry.accountId));
    snapshot.loans.push(...tag(entry.loans.records, entry.accountId));
    snapshot.dropped +=
      entry.deposits.dropped +
      entry.withdrawals.dropped +
      entry.purchases.dropped +
      entry.transfers.dropped +
      entry.bills.dropped +
      entry.loans.dropped;
  }

  return snapshot;
}
