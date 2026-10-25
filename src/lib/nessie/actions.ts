import { buildAccountsView, SEED_LABEL_PREFIX, withPostedActivity, type AccountsView } from "@/lib/nessie/account-view";
import {
  createBill,
  createDeposit,
  createTransfer,
  createWithdrawal,
  fetchNessieSnapshot,
  type LiveNessieConfig,
} from "@/lib/nessie/client";
import { getNessieConfig } from "@/lib/nessie/config";
import { NessieError } from "@/lib/nessie/errors";
import { addMockBill, addMockDeposit, addMockTransfer, addMockWithdrawal } from "@/lib/nessie/mock-store";
import { mockSnapshot } from "@/lib/nessie/mock";
import type { NessieAccount, NessieSnapshot } from "@/lib/nessie/types";

const MAX_AMOUNT = 20000;
const NO_CHECKING_ACCOUNT = "There's no checking account to post to.";
const NO_SAVINGS_ACCOUNT = "There's no savings account to transfer into.";

function assertAmount(amount: unknown): number {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    throw new NessieError("invalid_response", `Enter an amount between $1 and $${MAX_AMOUNT.toLocaleString()}.`);
  }
  return Math.round(amount * 100) / 100;
}

/**
 * Nessie's spec types deposit and withdrawal `amount` as an integer (bills
 * are floats), so cents are refused here rather than left for the sandbox
 * to truncate or reject.
 */
function assertWholeDollars(amount: unknown): number {
  const value = assertAmount(amount);
  if (!Number.isInteger(value)) {
    throw new NessieError("invalid_response", "Deposits and transactions are in whole dollars. Remove the cents.");
  }
  return value;
}

function assertText(value: unknown, fallback: string): string {
  // The seed label marks records already counted in the opening balance (see
  // withPostedActivity), so user text must never carry it.
  const text = typeof value === "string" ? value.trim().replace(SEED_LABEL_PREFIX, "") : "";
  return text.slice(0, 100) || fallback;
}

function assertDayOfMonth(value: unknown): number {
  const day = Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    throw new NessieError("invalid_response", "Pick a due day between 1 and 28.");
  }
  return day;
}

function checkingOf(snapshot: NessieSnapshot): NessieAccount {
  const checking = snapshot.accounts.find((a) => a.type === "Checking") ?? snapshot.accounts[0];
  if (!checking) throw new NessieError("insufficient_data", NO_CHECKING_ACCOUNT);
  return checking;
}

function savingsOf(snapshot: NessieSnapshot): NessieAccount {
  const savings = snapshot.accounts.find((a) => a.type === "Savings");
  if (!savings) throw new NessieError("insufficient_data", NO_SAVINGS_ACCOUNT);
  return savings;
}

function assertCovered(amount: number, checking: NessieAccount): void {
  if (amount > checking.balance) {
    throw new NessieError(
      "insufficient_data",
      `That's more than the $${checking.balance.toLocaleString()} in ${checking.nickname || "checking"}.`,
    );
  }
}

async function liveSnapshot(cfg: LiveNessieConfig): Promise<NessieSnapshot> {
  return withPostedActivity(await fetchNessieSnapshot(cfg));
}

/** Current snapshot, as the Banking tab's live-account section displays it. */
export async function readAccountsView(): Promise<AccountsView> {
  const cfg = getNessieConfig();
  if (cfg.mode === "mock") return buildAccountsView(mockSnapshot(), "mock");
  return buildAccountsView(await liveSnapshot(cfg), "live");
}

export interface DepositInput {
  amount: unknown;
  description: unknown;
}

export async function postDeposit(input: DepositInput): Promise<AccountsView> {
  const amount = assertWholeDollars(input.amount);
  const description = assertText(input.description, "Deposit");
  const cfg = getNessieConfig();

  if (cfg.mode === "mock") {
    addMockDeposit(amount, description);
    return buildAccountsView(mockSnapshot(), "mock");
  }

  const checking = checkingOf(await fetchNessieSnapshot(cfg));
  await createDeposit(cfg, checking._id, amount, description);
  return buildAccountsView(await liveSnapshot(cfg), "live");
}

export interface WithdrawalInput {
  amount: unknown;
  description: unknown;
}

export async function postWithdrawal(input: WithdrawalInput): Promise<AccountsView> {
  const amount = assertWholeDollars(input.amount);
  const description = assertText(input.description, "Withdrawal");
  const cfg = getNessieConfig();

  if (cfg.mode === "mock") {
    assertCovered(amount, checkingOf(mockSnapshot()));
    addMockWithdrawal(amount, description);
    return buildAccountsView(mockSnapshot(), "mock");
  }

  const checking = checkingOf(await liveSnapshot(cfg));
  assertCovered(amount, checking);
  await createWithdrawal(cfg, checking._id, amount, description);
  return buildAccountsView(await liveSnapshot(cfg), "live");
}

export interface TransferInput {
  amount: unknown;
  description: unknown;
}

/** Checking → savings. Fixed direction: this demo customer only has one of each. */
export async function postTransfer(input: TransferInput): Promise<AccountsView> {
  const amount = assertWholeDollars(input.amount);
  const description = assertText(input.description, "Transfer to savings");
  const cfg = getNessieConfig();

  if (cfg.mode === "mock") {
    assertCovered(amount, checkingOf(mockSnapshot()));
    addMockTransfer(amount, description);
    return buildAccountsView(mockSnapshot(), "mock");
  }

  const snapshot = await liveSnapshot(cfg);
  const checking = checkingOf(snapshot);
  const savings = savingsOf(snapshot);
  assertCovered(amount, checking);
  await createTransfer(cfg, checking._id, savings._id, amount, description);
  return buildAccountsView(await liveSnapshot(cfg), "live");
}

export interface BillInput {
  amount: unknown;
  nickname: unknown;
  payee: unknown;
  dayOfMonth: unknown;
}

export async function postBill(input: BillInput): Promise<AccountsView> {
  const amount = assertAmount(input.amount);
  const nickname = assertText(input.nickname, "Bill");
  const payee = assertText(input.payee, "Payee");
  const dayOfMonth = assertDayOfMonth(input.dayOfMonth);
  const cfg = getNessieConfig();

  if (cfg.mode === "mock") {
    addMockBill(amount, nickname, payee, dayOfMonth);
    return buildAccountsView(mockSnapshot(), "mock");
  }

  const checking = checkingOf(await fetchNessieSnapshot(cfg));
  await createBill(cfg, checking._id, amount, nickname, payee, dayOfMonth);
  return buildAccountsView(await liveSnapshot(cfg), "live");
}
