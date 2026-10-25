import type { AccountsView } from "@/lib/nessie/account-view";

export interface BankSummary {
  monthlyIncome: number;
  livingExpenses: number;
  debtPayments: number;
  availableCashFlow: number;
}

/** Average days-per-month span covered by the dated transactions, at least one month. */
function monthsSpanned(dates: string[]): number {
  const valid = dates.filter(Boolean).sort();
  if (valid.length === 0) return 1;
  const first = new Date(valid[0]).getTime();
  const last = new Date(valid[valid.length - 1]).getTime();
  const days = Math.max(1, (last - first) / (24 * 60 * 60 * 1000));
  return Math.max(1, days / 30);
}

/**
 * A live summary of the buyer's checking + savings activity — what's
 * actually come in and gone out, not the one-time estimate from when the
 * plan was built. Deposits are income, everything else (other than a
 * transfer between the buyer's own accounts, or a Savor Rewards charge) is
 * a living expense, averaged over the span of dated activity so it reads
 * as a monthly figure. Debt payments is exactly the credit card's own
 * balance — the same number the "Savor Rewards" panel shows — not an
 * estimate layered on top of it, so card purchases are left out of the
 * loop below rather than counted twice.
 */
export function summarizeBankActivity(data: AccountsView): BankSummary {
  const cardNickname = data.accounts.find((a) => a.type === "Credit Card")?.nickname;
  const months = monthsSpanned(data.transactions.map((t) => t.date));

  let income = 0;
  let living = 0;

  for (const t of data.transactions) {
    if (t.kind === "transfer" || t.account === cardNickname) continue;
    if (t.direction === "in") {
      income += t.amount;
    } else {
      living += t.amount;
    }
  }

  // Recurring bills are monthly by nature, not spread over the observed
  // window like one-off activity is.
  const recurringBills = data.bills.reduce((sum, b) => sum + b.amount, 0);

  const monthlyIncome = Math.round(income / months);
  const livingExpenses = Math.round(living / months + recurringBills);
  const debtPayments = Math.round(data.creditCardBalance);
  const availableCashFlow = Math.max(0, monthlyIncome - livingExpenses - debtPayments);

  return { monthlyIncome, livingExpenses, debtPayments, availableCashFlow };
}
