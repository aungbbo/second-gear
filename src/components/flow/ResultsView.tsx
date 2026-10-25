"use client";

import { useState } from "react";
import { ChevronLeft, Trophy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { CarRow } from "@/components/flow/CarRow";
import type { PipelineResult } from "@/lib/types";

interface ResultsViewProps {
  result: PipelineResult;
  onBack: () => void;
  onCompare: () => void;
}

const TOP_PICKS = 3;

export function ResultsView({ result, onBack, onCompare }: ResultsViewProps) {
  const [showAllRanked, setShowAllRanked] = useState(false);
  const { credit, affordability, rankedCars, savingsHighlight, need } = result;
  const topPicks = rankedCars.slice(0, TOP_PICKS);
  const displayedCars = showAllRanked ? rankedCars : topPicks;
  const rankingLabel = result.rankingSource === "bitdeer"
    ? "Ranked by Bitdeer AI"
    : result.rankingSource === "bitdeer_with_fallback"
      ? "Bitdeer AI ranking · completed locally"
      : "Local ranking fallback";

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
      </div>

      <div className="mt-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <Eyebrow icon={<Trophy className="w-3.5 h-3.5" />}>Ranked for your needs</Eyebrow>
          <h1 className="font-display font-extrabold text-[2rem] sm:text-[2.5rem] leading-tight mt-2">Your best options</h1>
        </div>
        <div className="bg-card border border-line rounded-2xl px-4 py-3 shrink-0">
          <p className="text-xs text-ink-soft">Your monthly target</p>
          <p className="font-display font-bold text-xl text-teal mt-0.5">≤ ${need.maxMonthlyPayment}/mo</p>
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
                {credit.estimatedApr.min === credit.estimatedApr.max
                  ? `${credit.estimatedApr.min.toFixed(2)}%`
                  : `${credit.estimatedApr.min.toFixed(2)}–${credit.estimatedApr.max.toFixed(2)}%`}
              </p>
              <p className="flex items-center gap-1.5 text-xs text-ink-soft">
                average APR
                <a
                  href="https://www.experian.com/blogs/ask-experian/average-car-loan-interest-rates-by-credit-score/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-teal-deep underline underline-offset-2 hover:text-teal"
                  aria-label="Experian source for average auto loan interest rates by credit score (opens in a new tab)"
                >
                  (Experian)
                </a>
              </p>
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

      <div className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium text-ink-soft">{rankingLabel} · {rankedCars.length} listings</p>
          {rankedCars.length > TOP_PICKS && (
            <button
              type="button"
              onClick={() => setShowAllRanked((visible) => !visible)}
              className="text-sm font-semibold text-teal-deep underline underline-offset-4 hover:text-teal"
            >
              {showAllRanked ? "Show top picks" : `Show all ${rankedCars.length} ranked listings`}
            </button>
          )}
        </div>
        <div className="mx-auto mt-4 grid w-full grid-cols-1 gap-5">
          {displayedCars.map((car) => (
            <CarRow key={car.listing.id} car={car} />
          ))}
        </div>
      </div>

      <Button size="lg" onClick={onCompare} className="mt-8 w-full justify-center">
        Compare buy now and wait →
      </Button>
    </div>
  );
}
