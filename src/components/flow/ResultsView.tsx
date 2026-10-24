"use client";

import { Button } from "@/components/ui/Button";
import { CarRow } from "@/components/flow/CarRow";
import type { PipelineResult } from "@/lib/types";

interface ResultsViewProps {
  result: PipelineResult;
  onGetPacket: () => void;
  onStartOver: () => void;
}

export function ResultsView({ result, onGetPacket, onStartOver }: ResultsViewProps) {
  const { credit, affordability, listings, rankedCars, savingsHighlight } = result;

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-ink-soft">
        {listings.length} listings reviewed near {result.need.zip}
      </p>
      <h1 className="font-display text-[2rem] sm:text-[2.4rem] leading-tight mt-1">
        {rankedCars.length} cars worth a look, ranked by true cost.
      </h1>

      <div className="mt-8 border border-line bg-paper-raised/60 p-6 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
        <div>
          <p className="font-display text-3xl sm:text-4xl text-moss tabular">
            ${savingsHighlight.amount.toLocaleString()}
          </p>
          <p className="text-xs text-ink-soft mt-1">saved by choosing the right loan</p>
        </div>
        <div className="sm:border-l sm:border-line sm:pl-8">
          <p className="text-sm leading-relaxed">{savingsHighlight.description}</p>
        </div>
      </div>

      <div className="mt-8 grid sm:grid-cols-2 gap-5">
        <div className="border border-line p-5">
          <p className="text-sm font-medium">Your credit, in plain terms</p>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed">{credit.summary}</p>
          <div className="mt-4 flex gap-6 text-sm">
            <div>
              <p className="font-display text-xl tabular">{credit.score}</p>
              <p className="text-xs text-ink-soft">{credit.tierLabel}</p>
            </div>
            <div>
              <p className="font-display text-xl tabular">
                {credit.estimatedApr.min}–{credit.estimatedApr.max}%
              </p>
              <p className="text-xs text-ink-soft">likely APR range</p>
            </div>
          </div>
        </div>

        <div className="border border-line p-5">
          <p className="text-sm font-medium">What you can safely pay</p>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed">{affordability.summary}</p>
          <div className="mt-4 flex gap-6 text-sm">
            <div>
              <p className="font-display text-xl tabular">${affordability.recommendedPayment}</p>
              <p className="text-xs text-ink-soft">recommended /mo</p>
            </div>
            <div>
              <p className="font-display text-xl tabular">${affordability.maxSustainablePayment}</p>
              <p className="text-xs text-ink-soft">hard ceiling /mo</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-12">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl">Ranked for you</h2>
          <p className="text-sm text-ink-soft">tap a row for the full breakdown</p>
        </div>
        <div className="mt-4 border-t border-line">
          {rankedCars.map((car) => (
            <CarRow key={car.listing.id} car={car} />
          ))}
        </div>
      </div>

      <div className="mt-10 flex items-center gap-4">
        <Button size="lg" onClick={onGetPacket}>
          Get my dealer packet
        </Button>
        <Button variant="ghost" onClick={onStartOver}>
          Start a new search
        </Button>
      </div>
    </div>
  );
}
