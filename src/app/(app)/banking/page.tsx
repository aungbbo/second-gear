"use client";

import { useState } from "react";
import { Landmark, ArrowLeft, Car } from "lucide-react";
import Link from "next/link";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Slider } from "@/components/ui/Slider";
import { EmptyPlanState } from "@/components/EmptyPlanState";
import { LiveAccountCard } from "@/components/banking/LiveAccountCard";
import { useAppState } from "@/lib/app-state";

// Mirrors the constants in lib/nessie/cashflow.ts, so this live "what-if"
// slider tracks the same policy the server used to compute the real numbers.
const CAR_PAYMENT_SHARE_OF_INCOME = 0.18;
const BUFFER_SHARE_FOR_CAR = 0.7;
const RECOMMENDED_SHARE_OF_MAX = 0.88;
const MIN_SUSTAINABLE_PAYMENT = 150;

export default function BankingPage() {
  const { result } = useAppState();
  const [essentials, setEssentials] = useState(result?.affordability.essentialExpenses ?? 0);

  if (!result) return <EmptyPlanState title="No banking data yet" />;

  const { affordability, need } = result;

  const discretionary = Math.max(
    120,
    affordability.avgMonthlyIncome - essentials - affordability.existingDebtPayments,
  );
  const safeCeiling = Math.round((affordability.avgMonthlyIncome * CAR_PAYMENT_SHARE_OF_INCOME - affordability.existingDebtPayments) / 5) * 5;
  const maxSustainable = Math.max(
    MIN_SUSTAINABLE_PAYMENT,
    Math.min(need.maxMonthlyPayment, safeCeiling, Math.round(discretionary * BUFFER_SHARE_FOR_CAR)),
  );
  const recommended = Math.round((maxSustainable * RECOMMENDED_SHARE_OF_MAX) / 5) * 5;

  const total = affordability.avgMonthlyIncome;
  const essentialsPct = (essentials / total) * 100;
  const debtPct = (affordability.existingDebtPayments / total) * 100;
  const availablePct = Math.max(0, 100 - essentialsPct - debtPct);

  return (
    <section className="mx-auto max-w-4xl px-6 py-12 sm:py-16">
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow icon={<Landmark className="w-3.5 h-3.5" />}>Your accounts</Eyebrow>
          <h1 className="font-display font-extrabold text-[2rem] sm:text-[2.5rem] leading-tight mt-2">Banking</h1>
          <p className="mt-1 text-ink-soft">Adjust expenses to test your car budget.</p>
        </div>
        <Link
          href="/find-my-car"
          className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium border border-line rounded-full px-4 py-2 hover:border-ink/40"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Return to my plan
        </Link>
      </div>

      <div className="mt-8">
        <LiveAccountCard />
      </div>

      <div className="mt-8">
        <Eyebrow icon={<Car className="w-3.5 h-3.5" />}>From your last plan</Eyebrow>
      </div>

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatTile label="Monthly income" value={`$${affordability.avgMonthlyIncome.toLocaleString()}`} />
        <StatTile label="Living expenses" value={`$${essentials.toLocaleString()}`} />
        <StatTile label="Debt payments" value={`$${affordability.existingDebtPayments.toLocaleString()}`} />
        <StatTile label="Available cash flow" value={`$${Math.round(discretionary).toLocaleString()}`} highlight />
      </div>

      <div className="mt-5 grid sm:grid-cols-2 gap-5">
        <div className="bg-card border border-line rounded-2xl p-6">
          <p className="font-medium">Income breakdown</p>
          <div className="mt-4 h-3 rounded-full overflow-hidden flex">
            <div className="bg-ink" style={{ width: `${essentialsPct}%` }} />
            <div className="bg-gold" style={{ width: `${debtPct}%` }} />
            <div className="bg-paper-high" style={{ width: `${availablePct}%` }} />
          </div>
          <div className="mt-2 flex gap-4 text-xs text-ink-soft">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-ink inline-block" /> Living expenses
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-gold inline-block" /> Debt
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-paper-high inline-block" /> Available {Math.round(availablePct)}%
            </span>
          </div>

          <div className="mt-6">
            <Slider
              label="Adjust estimated living expenses"
              value={essentials}
              min={Math.round(affordability.essentialExpenses * 0.5)}
              max={Math.round(affordability.essentialExpenses * 1.5)}
              step={10}
              onChange={setEssentials}
              formatValue={(v) => `$${v.toLocaleString()}`}
            />
          </div>
        </div>

        <div className="bg-card border border-line rounded-2xl p-6 flex flex-col items-center text-center justify-center">
          <span className="w-12 h-12 rounded-xl bg-teal-paper flex items-center justify-center">
            <Car className="w-5 h-5 text-teal-deep" />
          </span>
          <p className="text-xs text-ink-soft mt-3">Recommended loan payment</p>
          <p className="font-display font-extrabold text-4xl text-teal mt-1 tabular">
            ${recommended}
            <span className="text-base font-medium text-ink-soft">/mo</span>
          </p>
          {essentials !== affordability.essentialExpenses && (
            <p className="text-xs text-ink-soft mt-2">Recalculated for your adjusted living expenses.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function StatTile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 border ${highlight ? "bg-teal-paper border-teal/30" : "bg-card border-line"}`}>
      <p className="text-xs text-ink-soft">{label}</p>
      <p className={`font-display font-bold text-xl tabular mt-1 ${highlight ? "text-teal-deep" : ""}`}>{value}</p>
    </div>
  );
}
