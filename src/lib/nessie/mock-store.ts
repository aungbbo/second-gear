/**
 * In-memory stand-in for writes made in NESSIE_MODE=mock, so the "+ Deposit"
 * / "+ Transaction" / "+ Recurring bill" buttons are interactive in the demo
 * too, not just against the live sandbox. Kept on globalThis so dev-server
 * module reloads don't wipe it mid-session; resets on process restart.
 */

export interface MockTransactionWrite {
  amount: number;
  description: string;
  date: string;
}

export interface MockBillWrite {
  amount: number;
  nickname: string;
  payee: string;
  dayOfMonth: number;
}

interface MockWrites {
  deposits: MockTransactionWrite[];
  withdrawals: MockTransactionWrite[];
  transfers: MockTransactionWrite[];
  bills: MockBillWrite[];
}

const state = globalThis as typeof globalThis & { __secondGearMockNessieWrites?: MockWrites };

function store(): MockWrites {
  return (state.__secondGearMockNessieWrites ??= { deposits: [], withdrawals: [], transfers: [], bills: [] });
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export function addMockDeposit(amount: number, description: string): void {
  store().deposits.push({ amount, description, date: todayIso() });
}

export function addMockWithdrawal(amount: number, description: string): void {
  store().withdrawals.push({ amount, description, date: todayIso() });
}

export function addMockTransfer(amount: number, description: string): void {
  store().transfers.push({ amount, description, date: todayIso() });
}

export function addMockBill(amount: number, nickname: string, payee: string, dayOfMonth: number): void {
  store().bills.push({ amount, nickname, payee, dayOfMonth });
}

export function getMockWrites(): MockWrites {
  return store();
}

export function __resetMockNessieWritesForTests(): void {
  state.__secondGearMockNessieWrites = undefined;
}
