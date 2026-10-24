/**
 * Record shapes returned by the Nessie sandbox, as documented by the
 * official nessieisreal SDKs. Only the fields the analyzer reads are typed;
 * optional fields are frequently absent in seeded sandbox data.
 */

export type NessieAccountType = "Credit Card" | "Savings" | "Checking";

export interface NessieAccount {
  _id: string;
  type: NessieAccountType | string;
  nickname?: string;
  balance: number;
  rewards?: number;
  customer_id?: string;
}

export interface NessieDeposit {
  _id: string;
  transaction_date?: string;
  status?: string;
  type?: string;
  medium?: string;
  payee_id?: string;
  amount: number;
  description?: string;
}

export interface NessieWithdrawal {
  _id: string;
  transaction_date?: string;
  status?: string;
  type?: string;
  medium?: string;
  payer_id?: string;
  amount: number;
  description?: string;
}

export interface NessiePurchase {
  _id: string;
  purchase_date?: string;
  status?: string;
  type?: string;
  merchant_id?: string;
  payer_id?: string;
  medium?: string;
  amount: number;
  description?: string;
}

export interface NessieBill {
  _id: string;
  status?: string;
  payee?: string;
  nickname?: string;
  creation_date?: string;
  payment_date?: string;
  recurring_date?: number;
  upcoming_payment_date?: string;
  payment_amount: number;
  account_id?: string;
}

export interface NessieLoan {
  _id: string;
  type?: string;
  status?: string;
  credit_score?: number;
  monthly_payment: number;
  amount?: number;
  description?: string;
  creation_date?: string;
}

/** Records tagged with the account they were fetched from. */
export type WithAccount<T> = T & { accountId: string };

export interface NessieSnapshot {
  accounts: NessieAccount[];
  deposits: WithAccount<NessieDeposit>[];
  withdrawals: WithAccount<NessieWithdrawal>[];
  purchases: WithAccount<NessiePurchase>[];
  bills: WithAccount<NessieBill>[];
  loans: WithAccount<NessieLoan>[];
  loansSupported: boolean;
  /** Records discarded because they failed shape validation. */
  dropped: number;
}
