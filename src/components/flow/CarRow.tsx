"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink, TriangleAlert } from "lucide-react";
import { CarSwatch } from "@/components/CarSwatch";
import type { RankedCar } from "@/lib/types";

interface CarRowProps {
  car: RankedCar;
}

export function CarRow({ car }: CarRowProps) {
  const [open, setOpen] = useState(false);
  const { listing, bestScenario, allScenarios, warnings } = car;

  const tone = !bestScenario.withinBudget
    ? "rust"
    : car.rank === 1
      ? "moss"
      : "gold";

  const toneClasses: Record<string, string> = {
    moss: "bg-moss-paper text-moss",
    gold: "bg-gold-paper text-gold-deep",
    rust: "bg-rust-paper text-rust",
  };

  return (
    <div className="border-b border-line">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative w-full py-6 pr-8 flex flex-wrap items-start gap-x-5 gap-y-3 text-left hover:bg-paper-raised/40 transition-colors px-2 -mx-2"
      >
        <div className="flex items-start gap-4 shrink-0">
          <span className="font-display text-xl text-ink-soft w-6 pt-1 shrink-0 tabular">{car.rank}</span>
          <CarSwatch make={listing.make} model={listing.model} hue={listing.accentHue} />
        </div>

        <div className="flex-1 min-w-[180px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="font-medium text-[1.08rem]">
              {listing.year} {listing.make} {listing.model} {listing.trim}
            </h3>
            <span className={`text-xs px-2 py-0.5 ${toneClasses[tone]}`}>{car.headline}</span>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            {listing.mileage.toLocaleString()} mi · {listing.dealerName} · {listing.city}, {listing.state}
          </p>
          {warnings.length > 0 && (
            <div className="mt-2 flex items-start gap-1.5 text-sm text-rust">
              <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{warnings[0]}</span>
            </div>
          )}
        </div>

        <div className="w-full sm:w-auto sm:ml-auto text-left sm:text-right shrink-0 pt-3 sm:pt-0 border-t border-line/60 sm:border-0">
          <p className="font-display text-2xl tabular leading-none">${bestScenario.monthlyPayment}</p>
          <p className="text-xs text-ink-soft mt-1">
            /mo · {bestScenario.termMonths} mo @ {bestScenario.apr}%
          </p>
          <p className="text-xs text-ink-soft mt-0.5 tabular">
            ${bestScenario.totalInterest.toLocaleString()} interest
          </p>
        </div>

        <ChevronDown
          className={`absolute right-2 top-6 w-5 h-5 text-ink-soft shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="pb-7 pl-11 pr-2">
          <p className="text-[0.95rem] leading-relaxed text-ink-soft max-w-2xl">{car.explanation}</p>

          {listing.listingUrl && (
            <a
              href={listing.listingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4 hover:text-ink-soft"
            >
              View listing
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}

          {warnings.length > 1 && (
            <ul className="mt-3 space-y-1.5">
              {warnings.slice(1).map((w) => (
                <li key={w} className="flex items-start gap-1.5 text-sm text-rust">
                  <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
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
  );
}
