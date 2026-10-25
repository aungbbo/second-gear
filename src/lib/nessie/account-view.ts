import type { NessieSnapshot } from "@/lib/nessie/types";

export interface AccountSummaryView {
  type: string;
  nickname: string;
  balance: number;
}

export type TransactionDirection = "in" | "out";

export interface TransactionView {
  /** YYYY-MM-DD, or "" when Nessie didn't supply a usable date. */
  date: string;
  description: string;
  amount: number;
  direction: TransactionDirection;
  account: string;
}

export interface BillView {
  label: string;
  amount: number;
  /** Day of month the bill recurs on, when Nessie provided one. */
  dueDay: number | null;
}

export interface LoanView {
  label: string;
  monthlyPayment: number;
  status: string;
}

export interface AccountsView {
  source: "live" | "mock";
  /** Cash on hand: checking + savings. Card balances are money owed, so they're excluded. */
  totalBalance: number;
  /** Combined credit-card balance owed. */
  creditCardBalance: number;
  accounts: AccountSummaryView[];
  transactions: TransactionView[];
  bills: BillView[];
  loans: LoanView[];
}

// The sandbox seed script (scripts/nessie-seed.mjs) tags every record it
// creates with an "sg-seed: " prefix and, for dated transactions, a trailing
// "(YYYY-MM-DD)" — a dedupe/identification label for the seeding tool, not
// something a buyer should see. Stripping it is a no-op on real,
// non-seeded data (including anything created via the "+" buttons).
export const SEED_LABEL_PREFIX = /^sg-seed:\s*/i;
const TRAILING_ISO_DATE = /\s*\(\d{4}-\d{2}-\d{2}\)\s*$/;

function cleanLabel(text: string | undefined): string {
  return (text ?? "").replace(SEED_LABEL_PREFIX, "").replace(TRAILING_ISO_DATE, "").trim();
}

const cents = (n: number) => Math.round(n * 100) / 100;

function postedSinceOpening(record: { status?: string; description?: string }): boolean {
  return record.status !== "cancelled" && !SEED_LABEL_PREFIX.test(record.description ?? "");
}

/**
 * The live sandbox never moves an account's `balance` after the account is
 * created. Posting a deposit, withdrawal or purchase only adds a ledger
 * entry, and `PUT /accounts/{id}` returns 202 but silently ignores
 * `balance` (only `nickname` is updatable). So the stored balance is the
 * opening balance. The seed script opens each account at the persona's
 * balance *after* its seeded history, so only records without the seed
 * label are applied on top. Live snapshots only: mock mode already folds
 * its writes into the balance (see mock.ts).
 */
export function withPostedActivity(snapshot: NessieSnapshot): NessieSnapshot {
  const change = new Map<string, number>();
  const add = (accountId: string, amount: number) => change.set(accountId, (change.get(accountId) ?? 0) + amount);
  // The live sandbox's TransferCreate schema has no field for the destination
  // account (every name we tried — payee_id, transfer_to_id, toAccountId, even
  // as a query param — is rejected or silently dropped; verified 2026-10-24).
  // So a transfer's own record never says where the money went. This demo
  // customer has exactly one savings account, and postTransfer only ever
  // moves checking → savings, so that single account is always the credit
  // side regardless of what (if anything) the record's payee_id says.
  const savingsId = snapshot.accounts.find((a) => a.type === "Savings")?._id;
  for (const d of snapshot.deposits) if (postedSinceOpening(d)) add(d.accountId, d.amount);
  for (const w of snapshot.withdrawals) if (postedSinceOpening(w)) add(w.accountId, -w.amount);
  for (const p of snapshot.purchases) if (postedSinceOpening(p)) add(p.accountId, -p.amount);
  for (const t of snapshot.transfers) {
    if (!postedSinceOpening(t)) continue;
    add(t.accountId, -t.amount); // debit the source account the transfer was posted from
    const destination = t.payee_id || savingsId;
    if (destination) add(destination, t.amount); // credit the destination account
  }

  return {
    ...snapshot,
    accounts: snapshot.accounts.map((a) => {
      const net = change.get(a._id) ?? 0;
      // A card balance is money owed: a payment in lowers it, spending raises it.
      return { ...a, balance: cents(a.balance + (a.type === "Credit Card" ? -net : net)) };
    }),
  };
}

/**
 * Turns a raw Nessie snapshot into a flat, display-ready shape for the
 * Banking tab's live-account section. Deliberately drops every Nessie `_id`
 * — the write routes locate the right account server-side, so the browser
 * never needs one, and keeping them out of client-facing JSON matches how
 * the rest of the Nessie integration treats identifiers (see nessie/errors.ts).
 */
export function buildAccountsView(snapshot: NessieSnapshot, source: "live" | "mock"): AccountsView {
  const accountLabel = new Map(snapshot.accounts.map((a) => [a._id, cleanLabel(a.nickname) || a.type]));
  const label = (accountId: string) => accountLabel.get(accountId) ?? "Account";
  const savingsId = snapshot.accounts.find((a) => a.type === "Savings")?._id;

  const accounts: AccountSummaryView[] = snapshot.accounts.map((a) => ({
    type: a.type,
    nickname: cleanLabel(a.nickname) || a.type,
    balance: a.balance,
  }));

  const transactions: TransactionView[] = [
    ...snapshot.deposits.map(
      (d): TransactionView => ({
        date: d.transaction_date ?? "",
        description: cleanLabel(d.description) || "Deposit",
        amount: d.amount,
        direction: "in",
        account: label(d.accountId),
      }),
    ),
    ...snapshot.withdrawals.map(
      (w): TransactionView => ({
        date: w.transaction_date ?? "",
        description: cleanLabel(w.description) || "Withdrawal",
        amount: w.amount,
        direction: "out",
        account: label(w.accountId),
      }),
    ),
    ...snapshot.purchases.map(
      (p): TransactionView => ({
        date: p.purchase_date ?? "",
        description: cleanLabel(p.description) || "Purchase",
        amount: p.amount,
        direction: "out",
        account: label(p.accountId),
      }),
    ),
    ...snapshot.transfers.map((t): TransactionView => {
      const destination = t.payee_id || savingsId;
      return {
        date: t.transaction_date ?? "",
        description: cleanLabel(t.description) || `Transfer to ${destination ? label(destination) : "another account"}`,
        amount: t.amount,
        direction: "out",
        account: label(t.accountId),
      };
    }),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const bills: BillView[] = snapshot.bills
    .filter((b) => b.status === "recurring")
    .map((b) => ({
      label: cleanLabel(b.nickname) || cleanLabel(b.payee) || "Bill",
      amount: b.payment_amount,
      dueDay: typeof b.recurring_date === "number" ? b.recurring_date : null,
    }));

  const loans: LoanView[] = snapshot.loans.map((l) => ({
    label: cleanLabel(l.description) || cleanLabel(l.type) || "Loan",
    monthlyPayment: l.monthly_payment,
    status: l.status ?? "unknown",
  }));

  const totalBalance = cents(accounts.filter((a) => a.type !== "Credit Card").reduce((sum, a) => sum + a.balance, 0));
  const creditCardBalance = cents(
    accounts.filter((a) => a.type === "Credit Card").reduce((sum, a) => sum + a.balance, 0),
  );

  return { source, totalBalance, creditCardBalance, accounts, transactions, bills, loans };
}
