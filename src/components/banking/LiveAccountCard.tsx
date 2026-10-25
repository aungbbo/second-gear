"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Landmark, Plus, ArrowDownLeft, ArrowUpRight, ArrowRightLeft, Repeat, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { AccountsView } from "@/lib/nessie/account-view";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: AccountsView };

type FormKind = "deposit" | "withdrawal" | "transfer" | "bill" | null;

const ACTION_PATHS: Record<Exclude<FormKind, null>, string> = {
  deposit: "/api/nessie/accounts/deposit",
  withdrawal: "/api/nessie/accounts/withdrawal",
  transfer: "/api/nessie/accounts/transfer",
  bill: "/api/nessie/accounts/bill",
};

const TRANSACTION_LIMIT = 8;

const usd = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function LiveAccountCard() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [openForm, setOpenForm] = useState<FormKind>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/nessie/accounts");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't load account data.");
      setState({ status: "ready", data: body as AccountsView });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Couldn't load account data." });
    }
  }

  useEffect(() => {
    // One-time fetch on mount, not a sync with external state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function submit(kind: Exclude<FormKind, null>, payload: Record<string, unknown>) {
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch(ACTION_PATHS[kind], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "That didn't go through. Try again.");
      setState({ status: "ready", data: body as AccountsView });
      setOpenForm(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "That didn't go through. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (state.status === "loading") {
    return (
      <div className="bg-card border border-line rounded-2xl p-6">
        <p className="text-sm text-ink-soft">Loading your accounts…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="bg-card border border-rust/40 rounded-2xl p-6">
        <p className="text-sm text-rust">{state.message}</p>
      </div>
    );
  }

  const { data } = state;
  const shown = data.transactions.slice(0, TRANSACTION_LIMIT);

  return (
    <div className="bg-card border border-line rounded-2xl p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-teal-paper flex items-center justify-center shrink-0">
            <Landmark className="w-4.5 h-4.5 text-teal-deep" />
          </span>
          <div>
            <p className="font-medium">Live account</p>
            <p className="text-xs text-ink-soft">
              {data.accounts.map((a) => a.nickname).join(" · ") || "No accounts"}
            </p>
          </div>
        </div>
        {data.source === "live" && (
          <span className="text-xs font-medium px-2 py-1 rounded-full shrink-0 bg-teal-paper text-teal-deep">
            Live from Nessie
          </span>
        )}
      </div>

      <p className="mt-5 text-xs text-ink-soft">Total balance</p>
      <p className="font-display font-extrabold text-3xl tabular">${usd(data.totalBalance)}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        {data.accounts.map((a) => (
          <span key={a.nickname} className="tabular">
            {a.nickname}{" "}
            <span className="text-ink font-medium">
              {a.type === "Credit Card" ? `$${usd(a.balance)} owed` : `$${usd(a.balance)}`}
            </span>
          </span>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <ActionToggle
          label="Deposit"
          icon={<ArrowDownLeft className="w-3.5 h-3.5" />}
          active={openForm === "deposit"}
          onClick={() => setOpenForm(openForm === "deposit" ? null : "deposit")}
        />
        <ActionToggle
          label="Transaction"
          icon={<ArrowUpRight className="w-3.5 h-3.5" />}
          active={openForm === "withdrawal"}
          onClick={() => setOpenForm(openForm === "withdrawal" ? null : "withdrawal")}
        />
        <ActionToggle
          label="Transfer to savings"
          icon={<ArrowRightLeft className="w-3.5 h-3.5" />}
          active={openForm === "transfer"}
          onClick={() => setOpenForm(openForm === "transfer" ? null : "transfer")}
        />
        <ActionToggle
          label="Recurring bill"
          icon={<Repeat className="w-3.5 h-3.5" />}
          active={openForm === "bill"}
          onClick={() => setOpenForm(openForm === "bill" ? null : "bill")}
        />
      </div>

      {openForm && (
        <div className="mt-4 bg-paper-raised rounded-xl p-4">
          {openForm === "deposit" && (
            <TransactionForm
              submitLabel="Add deposit"
              submitting={submitting}
              error={formError}
              descriptionLabel="Source"
              descriptionPlaceholder="Payroll, rideshare, gift…"
              onCancel={() => setOpenForm(null)}
              onSubmit={(amount, description) => submit("deposit", { amount, description })}
            />
          )}
          {openForm === "withdrawal" && (
            <TransactionForm
              submitLabel="Add transaction"
              submitting={submitting}
              error={formError}
              descriptionLabel="What for"
              descriptionPlaceholder="Groceries, gas, ATM…"
              onCancel={() => setOpenForm(null)}
              onSubmit={(amount, description) => submit("withdrawal", { amount, description })}
            />
          )}
          {openForm === "transfer" && (
            <TransactionForm
              submitLabel="Transfer to savings"
              submitting={submitting}
              error={formError}
              descriptionLabel="Note (optional)"
              descriptionPlaceholder="Emergency fund, down payment…"
              caption="Checking → Savings"
              onCancel={() => setOpenForm(null)}
              onSubmit={(amount, description) => submit("transfer", { amount, description })}
            />
          )}
          {openForm === "bill" && (
            <BillForm
              submitting={submitting}
              error={formError}
              onCancel={() => setOpenForm(null)}
              onSubmit={(amount, nickname, payee, dayOfMonth) =>
                submit("bill", { amount, nickname, payee, dayOfMonth })
              }
            />
          )}
        </div>
      )}

      <div className="mt-6 grid sm:grid-cols-2 gap-5">
        <div>
          <p className="text-xs font-medium text-ink-soft uppercase tracking-wide">Recent activity</p>
          <div className="mt-2 border-t border-line">
            {shown.map((t, i) => (
              <div key={i} className="py-2.5 border-b border-line flex items-center gap-3">
                <span className="text-xs text-ink-soft w-16 shrink-0 tabular">{t.date || "—"}</span>
                <span className="flex-1 min-w-0 text-sm truncate">{t.description}</span>
                <span className={`tabular text-sm font-medium shrink-0 ${t.direction === "in" ? "text-teal" : "text-ink"}`}>
                  {t.direction === "in" ? "+" : "−"}${usd(t.amount)}
                </span>
              </div>
            ))}
            {shown.length === 0 && <p className="py-3 text-sm text-ink-soft">No activity yet.</p>}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-ink-soft uppercase tracking-wide">Recurring bills</p>
          <div className="mt-2 border-t border-line">
            {data.bills.map((b, i) => (
              <div key={i} className="py-2.5 border-b border-line flex items-center justify-between">
                <div>
                  <p className="text-sm">{b.label}</p>
                  {b.dueDay !== null && <p className="text-xs text-ink-soft">Due on the {ordinal(b.dueDay)}</p>}
                </div>
                <span className="tabular text-sm font-medium">${usd(b.amount)}</span>
              </div>
            ))}
            {data.bills.length === 0 && <p className="py-3 text-sm text-ink-soft">No recurring bills.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionToggle({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full border transition-colors ${
        active ? "border-teal bg-teal-paper text-teal-deep" : "border-line text-ink-soft hover:border-ink/30"
      }`}
    >
      {active ? <Plus className="w-3.5 h-3.5 rotate-45" /> : icon}
      {label}
    </button>
  );
}

function TransactionForm({
  submitLabel,
  descriptionLabel,
  descriptionPlaceholder,
  caption,
  submitting,
  error,
  onCancel,
  onSubmit,
}: {
  submitLabel: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  caption?: string;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (amount: number, description: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isInteger(value) || value <= 0) return;
    onSubmit(value, description);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {caption && <p className="text-xs font-medium text-teal-deep">{caption}</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-ink-soft">Amount</span>
          <div className="mt-1 flex items-center border border-line rounded-lg bg-card px-3 py-2">
            <span className="text-ink-soft mr-1">$</span>
            <input
              type="number"
              min={1}
              max={20000}
              step="1"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-transparent focus:outline-none tabular"
              placeholder="0"
            />
          </div>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink-soft">{descriptionLabel}</span>
          <input
            type="text"
            maxLength={100}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={descriptionPlaceholder}
            className="mt-1 w-full border border-line rounded-lg bg-card px-3 py-2 focus:outline-none"
          />
        </label>
      </div>
      {error && <p className="text-sm text-rust">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" size="md" disabled={submitting}>
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" size="md" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function BillForm({
  submitting,
  error,
  onCancel,
  onSubmit,
}: {
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (amount: number, nickname: string, payee: string, dayOfMonth: number) => void;
}) {
  const [amount, setAmount] = useState("");
  const [nickname, setNickname] = useState("");
  const [payee, setPayee] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState("1");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    const day = Number(dayOfMonth);
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(day) || day < 1 || day > 28) return;
    onSubmit(value, nickname, payee || nickname, day);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-ink-soft">Amount</span>
          <div className="mt-1 flex items-center border border-line rounded-lg bg-card px-3 py-2">
            <span className="text-ink-soft mr-1">$</span>
            <input
              type="number"
              min={1}
              max={20000}
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-transparent focus:outline-none tabular"
              placeholder="0.00"
            />
          </div>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink-soft">Due day of month</span>
          <input
            type="number"
            min={1}
            max={28}
            required
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(e.target.value)}
            className="mt-1 w-full border border-line rounded-lg bg-card px-3 py-2 focus:outline-none tabular"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink-soft">Bill name</span>
          <input
            type="text"
            required
            maxLength={60}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Rent, Internet, Phone…"
            className="mt-1 w-full border border-line rounded-lg bg-card px-3 py-2 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink-soft">Payee (optional)</span>
          <input
            type="text"
            maxLength={60}
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            placeholder="Landlord, utility company…"
            className="mt-1 w-full border border-line rounded-lg bg-card px-3 py-2 focus:outline-none"
          />
        </label>
      </div>
      {error && <p className="text-sm text-rust">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" size="md" disabled={submitting}>
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          Add recurring bill
        </Button>
        <Button type="button" variant="ghost" size="md" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
