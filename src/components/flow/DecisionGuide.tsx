"use client";

import { ChevronLeft, Car, PiggyBank, Check } from "lucide-react";
import { buildLoanScenario } from "@/lib/calculations";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { LogoMark } from "@/components/Logo";
import type { AffordabilityResult, PipelineResult } from "@/lib/types";

interface DecisionGuideProps {
  result: PipelineResult;
  onBack: () => void;
  onGetPacket: () => void;
}

const WAIT_MONTHS = 6;

function weeksLabel(weeks: number): string {
  if (weeks <= 2) return "within 2 weeks";
  if (weeks <= 4) return "within 1 month";
  if (weeks <= 12) return "within 3 months";
  return "whenever the timing works";
}

function monthlySavingsGoal(affordability: AffordabilityResult): number {
  const goal = affordability.discretionaryBuffer * 0.35;
  return Math.max(25, Math.round(goal / 5) * 5);
}

export function DecisionGuide({ result, onBack, onGetPacket }: DecisionGuideProps) {
  const top = result.rankedCars[0];
  if (!top) {
    return (
      <div className="max-w-xl mx-auto text-center">
        <p className="text-ink-soft">No ranked cars to compare yet.</p>
        <Button variant="ghost" onClick={onBack} className="mt-4">
          Back
        </Button>
      </div>
    );
  }

  const before = top.bestScenario;
  const savingsGoal = monthlySavingsGoal(result.affordability);
  const futureDownPayment = before.downPayment + savingsGoal * WAIT_MONTHS;
  const after = buildLoanScenario(
    top.listing.price,
    futureDownPayment,
    result.credit.estimatedApr.min,
    result.credit.estimatedApr.max,
    before.termMonths,
    result.affordability.maxSustainablePayment,
  );
  const loanSavings = Math.max(0, before.totalInterest - after.totalInterest);

  const buySooner = result.need.timeframeWeeks <= 8;
  const take = buySooner
    ? {
        title: "Buying sooner may be more practical.",
        body: `A ${WAIT_MONTHS}-month wait doesn't match your timeline (you said ${weeksLabel(
          result.need.timeframeWeeks,
        )}). Focus on the lower price and keep an emergency cushion.`,
      }
    : {
        title: "Waiting may be worth it here.",
        body: `Your timeline has room. Saving $${savingsGoal}/mo for ${WAIT_MONTHS} months would cut the monthly payment to $${after.monthlyPayment} and save roughly $${loanSavings.toLocaleString()} in interest.`,
      };

  return (
    <div className="max-w-3xl mx-auto">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <ChevronLeft className="w-4 h-4" /> Back
      </button>

      <div className="mt-6 text-center">
        <Eyebrow icon={<PiggyBank className="w-3.5 h-3.5" />}>Decision guide</Eyebrow>
        <h1 className="font-display font-extrabold text-[2rem] sm:text-[2.5rem] leading-tight mt-2">Buy now or wait?</h1>
        <p className="mt-2 text-ink-soft">You chose: {weeksLabel(result.need.timeframeWeeks)}.</p>
      </div>

      <div className="mt-8 grid sm:grid-cols-2 gap-5">
        <div className={`bg-card border-2 rounded-2xl p-6 ${buySooner ? "border-teal" : "border-line"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Car className="w-4 h-4 text-ink-soft" />
              <span className="text-xs font-semibold tracking-wide text-ink-soft uppercase">Option A</span>
            </div>
            {buySooner && <Check className="w-4 h-4 text-teal" />}
          </div>
          <p className="font-medium mt-1">Buy now</p>
          <p className="font-display font-extrabold text-3xl mt-3 tabular">
            ${before.monthlyPayment} <span className="text-base font-medium text-ink-soft">/ month loan</span>
          </p>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="Cash down" value={`$${before.downPayment.toLocaleString()}`} />
            <Row label="Total interest" value={`$${before.totalInterest.toLocaleString()}`} />
            <Row label="Total payments" value={`$${before.totalCost.toLocaleString()}`} />
          </dl>
          <p className="mt-4 text-xs text-ink-soft">
            <span className="font-semibold text-ink">Good:</span> meets your current timeline.
          </p>
          <p className="text-xs text-ink-soft">
            <span className="font-semibold text-ink">Tradeoff:</span> higher interest and less cash cushion.
          </p>
        </div>

        <div className={`bg-card border-2 rounded-2xl p-6 ${!buySooner ? "border-teal" : "border-line"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PiggyBank className="w-4 h-4 text-ink-soft" />
              <span className="text-xs font-semibold tracking-wide text-ink-soft uppercase">Option B</span>
            </div>
            {!buySooner && <Check className="w-4 h-4 text-teal" />}
          </div>
          <p className="font-medium mt-1">Wait and save {WAIT_MONTHS} months</p>
          <p className="font-display font-extrabold text-3xl mt-3 tabular">
            ${after.monthlyPayment} <span className="text-base font-medium text-ink-soft">/ month loan</span>
          </p>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="Monthly savings goal" value={`$${savingsGoal}`} />
            <Row label="Future down payment" value={`$${futureDownPayment.toLocaleString()}`} />
            <Row label="Calculated loan savings" value={`$${loanSavings.toLocaleString()}`} />
          </dl>
          <p className="mt-4 text-xs text-ink-soft">
            <span className="font-semibold text-ink">Good:</span> lower payment and more buying power.
          </p>
          <p className="text-xs text-ink-soft">
            <span className="font-semibold text-ink">Tradeoff:</span> requires {WAIT_MONTHS} more months without a
            car.
          </p>
        </div>
      </div>

      <div className="mt-6 bg-teal-paper/60 rounded-2xl p-5 flex items-start gap-4">
        <LogoMark className="w-10 h-10 shrink-0" />
        <div>
          <p className="text-xs font-semibold tracking-wide text-teal-deep uppercase">Second Gear&apos;s take</p>
          <p className="font-display font-bold italic text-lg mt-1">{take.title}</p>
          <p className="text-sm text-ink-soft mt-1">{take.body}</p>
        </div>
      </div>

      <Button size="lg" onClick={onGetPacket} className="mt-8 w-full justify-center">
        Generate dealer packet →
      </Button>
      <p className="mt-2 text-center text-xs text-ink-soft">No transfers occur. Any future transfer would need your clear approval.</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  );
}
