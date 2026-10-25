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
  const { listing, bestScenario, allScenarios, warnings, ownershipCosts, affordabilityDecision } = car;
  const fits = affordabilityDecision.status === "affordable";
  const statusLabel = fits
    ? "Fits monthly target"
    : affordabilityDecision.status === "financially_risky"
      ? "Fits with risks"
      : affordabilityDecision.status === "insufficient_data"
        ? "Needs more data"
        : "Above monthly target";

  return (
    <article className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${car.rank === 1 ? "border-2 border-teal" : "border-line"}`}>
      <div className="grid lg:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
        <div className="relative h-44 overflow-hidden sm:h-48 lg:h-full lg:min-h-[460px]">
          <CarSwatch make={listing.make} model={listing.model} hue={listing.accentHue} size="listing" />
          {car.rank === 1 && (
  <span className="absolute left-3 top-3 rounded-lg bg-teal px-3 py-1.5 text-[0.65rem] font-bold uppercase tracking-wide text-cream">
    Best overall
  </span>
)}
          <span className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-white/70 bg-white/90 font-display text-xs font-bold text-ink shadow-sm">
            #{car.rank}
          </span>
        </div>

        <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-bold leading-snug text-ink sm:text-xl">
              {listing.year} {listing.make} {listing.model} {listing.trim}
            </h3>
            <p className="mt-1 text-sm text-ink-soft">
              {listing.mileage.toLocaleString()} miles <span className="px-1">·</span> {listing.dealerName}
            </p>
            <p className="text-sm text-ink-soft">{listing.city}, {listing.state}</p>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[0.68rem] font-semibold ${fits ? "bg-teal-paper text-teal-deep" : "bg-rust-paper text-rust"}`}>
            {fits ? <Check className="h-3.5 w-3.5" /> : <TriangleAlert className="h-3.5 w-3.5" />}
            {statusLabel}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="font-display text-3xl font-extrabold tabular text-ink">${listing.price.toLocaleString()}</p>
          <p className="text-sm font-medium text-ink-soft">${bestScenario.monthlyPayment}/mo estimated loan payment</p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-y-3 border-y border-line py-3 sm:grid-cols-4 sm:gap-y-0">
          <Metric label="Illustrative terms" value={`${bestScenario.apr.toFixed(2)}% · ${bestScenario.termMonths} mo`} />
          <Metric label="Total interest" value={`$${bestScenario.totalInterest.toLocaleString()}`} />
          <Metric label="Total payments" value={`$${bestScenario.totalCost.toLocaleString()}`} />
          <Metric label="Total monthly cost" value={`$${ownershipCosts.totalMonthlyCost.toLocaleString()}`} highlight />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-teal-paper/60 px-3 py-3">
          <CostMetric label={`${car.ownershipEstimateSource === "ai" ? "AI " : "Baseline "}insurance est.`} value={ownershipCosts.insuranceMonthly} />
          <CostMetric label={`${car.ownershipEstimateSource === "ai" ? "AI " : "Baseline "}fuel est.`} value={ownershipCosts.fuelMonthly} />
          <CostMetric label={`${car.ownershipEstimateSource === "ai" ? "AI " : "Baseline "}maintenance est.`} value={ownershipCosts.maintenanceMonthly} />
        </div>
        {(ownershipCosts.registrationAndTaxesMonthly > 0 || ownershipCosts.otherMonthly > 0) && (
          <p className="mt-1.5 text-[0.68rem] text-ink-soft">
            Also includes ${ownershipCosts.registrationAndTaxesMonthly}/mo registration and taxes
            {ownershipCosts.otherMonthly > 0 ? ` and $${ownershipCosts.otherMonthly}/mo other costs` : ""}.
          </p>
        )}

        {listing.carfaxHistory && <CarfaxHistory history={listing.carfaxHistory} />}

        {warnings.length > 0 && (
          <div className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-rust">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{warnings[0]}</span>
          </div>
        )}

        </div>
      </div>
      <p className="border-t border-line px-4 py-4 text-sm leading-relaxed text-ink-soft sm:px-5">
        <span className="font-semibold text-ink">Why this car: </span>{car.explanation}
      </p>
      <div className={`grid gap-2 border-t border-line px-4 py-4 sm:px-5 ${listing.listingUrl ? "grid-cols-2" : "grid-cols-1"}`}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex w-full items-center justify-center gap-1 rounded-xl border border-line px-3 py-2.5 text-center text-xs font-semibold text-ink-soft transition-colors hover:bg-paper-raised hover:text-ink"
        >
          {open ? "Hide" : "View"} loan comparison
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {listing.listingUrl && (
          <a
            href={listing.listingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-1 rounded-xl bg-teal px-3 py-2.5 text-center text-xs font-bold text-cream transition-colors hover:bg-teal-deep"
          >
            Check availability <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </div>
      {open && (
        <div className="border-t border-line px-4 py-4 sm:px-5">
          {warnings.length > 1 && (
            <ul className="mb-3 space-y-1.5">
              {warnings.slice(1).map((warning) => (
                <li key={warning} className="flex items-start gap-1.5 text-xs text-rust">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[400px] text-xs">
              <thead>
                <tr className="border-b border-line text-left text-ink-soft">
                  <th className="py-2 pr-3 font-normal">Term</th>
                  <th className="py-2 pr-3 font-normal">APR</th>
                  <th className="py-2 pr-3 font-normal">Payment</th>
                  <th className="py-2 pr-3 font-normal">Total interest</th>
                  <th className="py-2 font-normal">Underwater</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {allScenarios.map((scenario) => (
                  <tr key={scenario.termMonths} className={`border-b border-line/60 ${scenario.termMonths === bestScenario.termMonths ? "text-ink" : "text-ink-soft"}`}>
                    <td className="py-2 pr-3">{scenario.termMonths} mo</td>
                    <td className="py-2 pr-3">{scenario.apr.toFixed(2)}%</td>
                    <td className="py-2 pr-3">${scenario.monthlyPayment}{!scenario.withinBudget && <span className="text-rust"> *</span>}</td>
                    <td className="py-2 pr-3">${scenario.totalInterest.toLocaleString()}</td>
                    <td className="py-2">{scenario.negativeEquityMonths} mo</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[0.68rem] text-ink-soft">* loan payment exceeds your monthly target.</p>
          </div>
        </div>
      )}
    </article>
  );
}

function Metric({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="min-w-0 sm:border-r sm:border-line sm:px-2.5 sm:first:pl-0 sm:last:border-r-0 sm:last:pr-0">
      <p className="text-[0.65rem] leading-tight text-ink-soft">{label}</p>
      <p className={`mt-1 font-display text-sm font-bold tabular sm:text-base ${highlight ? "text-rust" : "text-ink"}`}>{value}</p>
    </div>
  );
}

function CostMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[0.65rem] leading-tight text-ink-soft">{label}</p>
      <p className="mt-0.5 font-display text-sm font-bold tabular text-ink">${value.toLocaleString()}</p>
    </div>
  );
}

function CarfaxHistory({ history }: { history: NonNullable<RankedCar["listing"]["carfaxHistory"]> }) {
  const facts = [
    history.noAccidents !== undefined ? (history.noAccidents ? "No accidents reported" : "Accident reported") : null,
    history.oneOwner !== undefined ? (history.oneOwner ? "One previous owner" : "Multiple previous owners") : null,
    history.serviceRecords !== undefined ? (history.serviceRecords ? "Service records available" : "No service records reported") : null,
    history.ownerCount !== undefined ? `${history.ownerCount} owner record${history.ownerCount === 1 ? "" : "s"}` : null,
  ].filter((fact): fact is string => fact !== null);

  if (facts.length === 0 && !history.accidentNotes?.length && !history.serviceNotes?.length) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[0.65rem] text-ink-soft">
      <span className="font-semibold text-teal-deep">CARFAX</span>
      {facts.map((fact) => <span key={fact} className="rounded-full border border-line bg-card px-2 py-0.5">{fact}</span>)}
      {history.accidentNotes?.map((note, index) => <span key={`accident-${index}`} className="text-rust">{note}</span>)}
      {history.serviceNotes?.map((note, index) => <span key={`service-${index}`}>{note}</span>)}
    </div>
  );
}
