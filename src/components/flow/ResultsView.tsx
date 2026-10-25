"use client";

import { ChevronLeft, Trophy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { CarRow } from "@/components/flow/CarRow";
import { DownPaymentWhatIf } from "@/components/flow/DownPaymentWhatIf";
import type { PipelineResult } from "@/lib/types";

interface ResultsViewProps {
  result: PipelineResult;
  onBack: () => void;
  onCompare: () => void;
}

const SHOWN = 3;

export function ResultsView({ result, onBack, onCompare }: ResultsViewProps) {
  const { credit, affordability, rankedCars, savingsHighlight, need } = result;
  const shown = rankedCars.slice(0, SHOWN);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
      </div>

      <div className="mt-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <Eyebrow icon={<Trophy className="w-3.5 h-3.5" />}>Ranked for your needs</Eyebrow>
          <h1 className="font-display font-extrabold text-[2rem] sm:text-[2.5rem] leading-tight mt-2">Your best options.</h1>
          <p className="mt-2 text-ink-soft">
            Needed: {need.timeframeWeeks <= 4 ? "within 1 month" : "within a few months"}. Loan target: ${need.maxMonthlyPayment}.
          </p>
        </div>
        <div className="bg-card border border-line rounded-2xl px-4 py-3 shrink-0">
          <p className="text-xs text-ink-soft">Loan payment target</p>
          <p className="font-display font-bold text-xl text-teal mt-0.5">≤ ${need.maxMonthlyPayment}/mo</p>
          <p className="text-xs text-ink-soft mt-0.5">Uses your car and banking inputs</p>
        </div>
      </div>

      <div className="mt-6 bg-teal-paper rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-8">
        <div>
          <p className="font-display font-extrabold text-3xl text-teal-deep tabular">${savingsHighlight.amount.toLocaleString()}</p>
          <p className="text-xs text-ink-soft mt-1">saved by choosing the right loan</p>
        </div>
        <p className="text-sm leading-relaxed sm:border-l sm:border-teal/30 sm:pl-8">{savingsHighlight.description}</p>
      </div>

      <div className="mt-6 grid sm:grid-cols-2 gap-5">
        <div className="bg-card border border-line rounded-2xl p-5">
          <p className="text-sm font-medium">Your credit, in plain terms</p>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed">{credit.summary}</p>
          <div className="mt-4 flex gap-6 text-sm">
            <div>
              <p className="font-display font-bold text-xl tabular">{credit.score}</p>
              <p className="text-xs text-ink-soft">{credit.tierLabel}</p>
            </div>
            <div>
              <p className="font-display font-bold text-xl tabular">
                {credit.estimatedApr.min}–{credit.estimatedApr.max}%
              </p>
              <p className="text-xs text-ink-soft">estimated APR range</p>
            </div>
          </div>
        </div>

        <div className="bg-card border border-line rounded-2xl p-5">
          <p className="text-sm font-medium">What you can safely pay</p>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed">{affordability.summary}</p>
          <div className="mt-4 flex gap-6 text-sm">
            <div>
              <p className="font-display font-bold text-xl tabular">${affordability.recommendedPayment}</p>
              <p className="text-xs text-ink-soft">recommended /mo</p>
            </div>
            <div>
              <p className="font-display font-bold text-xl tabular">${affordability.maxSustainablePayment}</p>
              <p className="text-xs text-ink-soft">hard ceiling /mo</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10 space-y-5">
        {shown.map((car) => (
          <CarRow key={car.listing.id} car={car} />
        ))}
      </div>

      {rankedCars.length > SHOWN && (
        <p className="mt-4 text-center text-sm text-ink-soft">and {rankedCars.length - SHOWN} more options ranked below your top picks</p>
      )}

      {shown[0] && (
        <div className="mt-8">
          <DownPaymentWhatIf car={shown[0]} credit={credit} affordability={affordability} />
        </div>
      )}

      <Button size="lg" onClick={onCompare} className="mt-8 w-full justify-center">
        Compare buy now and wait →
      </Button>
    </div>
  );
}
