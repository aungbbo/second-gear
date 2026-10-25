"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink, TriangleAlert, Check } from "lucide-react";
import { CarSwatch } from "@/components/CarSwatch";
import type { RankedCar } from "@/lib/types";

interface CarRowProps {
  car: RankedCar;
}

export function CarRow({ car }: CarRowProps) {
  const [open, setOpen] = useState(false);
  const { listing, bestScenario, allScenarios, warnings } = car;
  const fits = bestScenario.withinBudget;

  return (
    <div className={`bg-card rounded-2xl border overflow-hidden ${car.rank === 1 ? "border-teal" : "border-line"}`}>
      <div className="relative">
        <CarSwatch make={listing.make} model={listing.model} hue={listing.accentHue} size="banner" />
        <span className="absolute top-3 left-3 bg-ink text-cream text-xs font-semibold px-2.5 py-1 rounded-full">
          {car.rank === 1 ? "Best overall" : `#${car.rank}`}
        </span>
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display font-bold text-lg leading-snug">
              {listing.year} {listing.make} {listing.model} {listing.trim}
            </h3>
            <p className="text-sm text-ink-soft mt-0.5">
              {listing.mileage.toLocaleString()} miles · ${listing.price.toLocaleString()}
            </p>
          </div>
          <span
            className={`shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${
              fits ? "bg-teal-paper text-teal-deep" : "bg-rust-paper text-rust"
            }`}
          >
            {fits && <Check className="w-3 h-3" />}
            {fits ? "Loan fits" : "Over budget"}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-4 pb-5 border-b border-line">
          <Stat label="Loan payment" value={`$${bestScenario.monthlyPayment}/mo`} />
          <Stat label="Estimated terms" value={`${bestScenario.apr}% · ${bestScenario.termMonths} mo`} />
          <Stat label="Total interest" value={`$${bestScenario.totalInterest.toLocaleString()}`} />
          <Stat label="Total payments" value={`$${bestScenario.totalCost.toLocaleString()}`} />
        </div>

        <p className="mt-4 text-sm leading-relaxed">
          <span className="font-semibold">Why this car: </span>
          <span className="text-ink-soft">{car.explanation}</span>
        </p>

        {warnings.length > 0 && (
          <div className="mt-3 flex items-start gap-1.5 text-sm text-rust">
            <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{warnings[0]}</span>
          </div>
        )}

        <div className="mt-4 flex items-center gap-5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4 hover:text-ink-soft"
          >
            {open ? "Hide" : "View"} full loan comparison
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {listing.listingUrl && (
            <a
              href={listing.listingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4 hover:text-ink-soft"
            >
              View listing
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </div>

        {open && (
          <div className="mt-5 pt-5 border-t border-line">
            {warnings.length > 1 && (
              <ul className="mb-4 space-y-1.5">
                {warnings.slice(1).map((w) => (
                  <li key={w} className="flex items-start gap-1.5 text-sm text-rust">
                    <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[440px]">
                <thead>
                  <tr className="border-b border-line text-left text-ink-soft">
                    <th className="font-normal py-2 pr-4">Term</th>
                    <th className="font-normal py-2 pr-4">APR</th>
                    <th className="font-normal py-2 pr-4">Payment</th>
                    <th className="font-normal py-2 pr-4">Total interest</th>
                    <th className="font-normal py-2">Underwater</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {allScenarios.map((s) => (
                    <tr
                      key={s.termMonths}
                      className={`border-b border-line/60 ${s.termMonths === bestScenario.termMonths ? "text-ink" : "text-ink-soft"}`}
                    >
                      <td className="py-2 pr-4">{s.termMonths} mo</td>
                      <td className="py-2 pr-4">{s.apr}%</td>
                      <td className="py-2 pr-4">
                        ${s.monthlyPayment}
                        {!s.withinBudget && <span className="text-rust"> *</span>}
                      </td>
                      <td className="py-2 pr-4">${s.totalInterest.toLocaleString()}</td>
                      <td className="py-2">{s.negativeEquityMonths} mo</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-ink-soft mt-2">* over your safe monthly budget</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="font-display font-bold text-[0.95rem] tabular mt-0.5">{value}</p>
    </div>
  );
}
