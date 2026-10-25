"use client";

import { useState } from "react";
import { Landmark, ArrowLeft, Car } from "lucide-react";
import Link from "next/link";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { EmptyPlanState } from "@/components/EmptyPlanState";
import { LiveAccountCard } from "@/components/banking/LiveAccountCard";
import { useAppState } from "@/lib/app-state";
import { summarizeBankActivity } from "@/lib/nessie/categorize";
import type { AccountsView } from "@/lib/nessie/account-view";

// Only a conservative share of the current leftover cash flow is suggested
// for a car payment, so the estimate responds directly to bank activity.
const AVAILABLE_CASH_FLOW_SHARE_FOR_CAR = 0.3;

export default function BankingPage() {
  const { result } = useAppState();
  const [bankData, setBankData] = useState<AccountsView | null>(null);
  const [hoveredBreakdown, setHoveredBreakdown] = useState<"living" | "debt" | "available" | null>(null);

  if (!result) return <EmptyPlanState title="No banking data yet" />;

  // Live, not the one-time estimate from when the plan was built: deposits
  // read as income, non-debt spending as living expenses, by description —
  // see categorize.ts. Null until LiveAccountCard's own fetch resolves.
  const summary = bankData ? summarizeBankActivity(bankData) : null;
  const essentials = summary?.livingExpenses ?? 0;

  const discretionary = summary?.availableCashFlow ?? 0;
  const recommended = Math.max(
    0,
    Math.round((discretionary * AVAILABLE_CASH_FLOW_SHARE_FOR_CAR) / 5) * 5,
  );

  const total = summary?.monthlyIncome || 1;
  const essentialsPct = (essentials / total) * 100;
  const debtPct = summary ? (summary.debtPayments / total) * 100 : 0;
  const availablePct = Math.max(0, 100 - essentialsPct - debtPct);

  return (
    <section className="mx-auto max-w-4xl px-6 py-12 sm:py-16">
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow icon={<Landmark className="w-3.5 h-3.5" />}>Your accounts</Eyebrow>
          <h1 className="font-display font-extrabold text-[2rem] sm:text-[2.5rem] leading-tight mt-2">Banking</h1>
        </div>
        <Link
          href="/find-my-car"
          className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium border border-line rounded-full px-4 py-2 hover:border-ink/40"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Return to my plan
        </Link>
      </div>

      <div className="mt-8">
        <LiveAccountCard onData={setBankData} />
      </div>

      <div className="mt-8">
        <Eyebrow icon={<Car className="w-3.5 h-3.5" />}>From your bank activity</Eyebrow>
      </div>

      {!summary ? (
        <p className="mt-3 text-sm text-ink-soft">Reading your checking and savings activity…</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatTile label="Monthly income" value={`$${summary.monthlyIncome.toLocaleString()}`} />
            <StatTile label="Living expenses" value={`$${essentials.toLocaleString()}`} />
            <StatTile label="Debt payments" value={`$${summary.debtPayments.toLocaleString()}`} />
            <StatTile label="Available cash flow" value={`$${Math.round(discretionary).toLocaleString()}`} highlight />
          </div>

          <div className="mt-5 grid sm:grid-cols-2 gap-5">
            <div className="bg-card border border-line rounded-2xl p-6">
              <p className="font-medium">Income breakdown</p>
              <div className="relative mt-4">
                {hoveredBreakdown && (
                  <div className="absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-3 py-2 text-xs text-white shadow-lg pointer-events-none">
                    {hoveredBreakdown === "living" && `Living expenses: ${Math.round(essentialsPct)}% · $${essentials.toLocaleString()}/mo`}
                    {hoveredBreakdown === "debt" && `Debt: ${Math.round(debtPct)}% · $${summary.debtPayments.toLocaleString()}/mo`}
                    {hoveredBreakdown === "available" && `Available: ${Math.round(availablePct)}% · $${Math.round(discretionary).toLocaleString()}/mo`}
                  </div>
                )}
                <div className="h-3 rounded-full overflow-hidden flex">
                  <button
                    type="button"
                    className="bg-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
                    style={{ width: `${essentialsPct}%` }}
                    onMouseEnter={() => setHoveredBreakdown("living")}
                    onMouseLeave={() => setHoveredBreakdown(null)}
                    onFocus={() => setHoveredBreakdown("living")}
                    onBlur={() => setHoveredBreakdown(null)}
                    aria-label={`Living expenses: ${Math.round(essentialsPct)} percent, $${essentials.toLocaleString()} per month`}
                  />
                  <button
                    type="button"
                    className="bg-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
                    style={{ width: `${debtPct}%` }}
                    onMouseEnter={() => setHoveredBreakdown("debt")}
                    onMouseLeave={() => setHoveredBreakdown(null)}
                    onFocus={() => setHoveredBreakdown("debt")}
                    onBlur={() => setHoveredBreakdown(null)}
                    aria-label={`Debt: ${Math.round(debtPct)} percent, $${summary.debtPayments.toLocaleString()} per month`}
                  />
                  <button
                    type="button"
                    className="bg-paper-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
                    style={{ width: `${availablePct}%` }}
                    onMouseEnter={() => setHoveredBreakdown("available")}
                    onMouseLeave={() => setHoveredBreakdown(null)}
                    onFocus={() => setHoveredBreakdown("available")}
                    onBlur={() => setHoveredBreakdown(null)}
                    aria-label={`Available: ${Math.round(availablePct)} percent, $${Math.round(discretionary).toLocaleString()} per month`}
                  />
                </div>
              </div>
              <div className="mt-2 flex gap-4 text-xs text-ink-soft">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-ink inline-block" /> Living expenses {Math.round(essentialsPct)}%
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-gold inline-block" /> Debt {Math.round(debtPct)}%
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-paper-high inline-block" /> Available {Math.round(availablePct)}%
                </span>
              </div>

            </div>

            <div className="bg-card border border-line rounded-2xl p-6 flex flex-col items-center text-center justify-center">
              <span className="w-12 h-12 rounded-xl bg-teal-paper flex items-center justify-center">
                <Car className="w-5 h-5 text-teal-deep" />
              </span>
              <p className="text-xs text-ink-soft mt-3">Estimated affordable auto payment</p>
              <p className="font-display font-extrabold text-4xl text-teal mt-1 tabular">
                ${recommended}
                <span className="text-base font-medium text-ink-soft">/mo</span>
              </p>
            </div>
          </div>
        </>
      )}
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
