"use client";

import { useState } from "react";
import { Wallet } from "lucide-react";
import { buildLoanScenario } from "@/lib/calculations";
import { Slider } from "@/components/ui/Slider";
import { Button } from "@/components/ui/Button";
import type { RankedCar, CreditReport, AffordabilityResult } from "@/lib/types";

interface DownPaymentWhatIfProps {
  car: RankedCar;
  credit: CreditReport;
  affordability: AffordabilityResult;
}

/**
 * Lets the buyer test a different down payment against the top pick. Uses
 * the same amortization math as the server (lib/calculations.ts) — no
 * invented numbers, just the real loan formula re-run client-side.
 */
export function DownPaymentWhatIf({ car, credit, affordability }: DownPaymentWhatIfProps) {
  const before = car.bestScenario;
  const maxDown = Math.min(10000, car.listing.price);
  const [downPayment, setDownPayment] = useState(before.downPayment);
  const [applied, setApplied] = useState(before.downPayment);

  const after = buildLoanScenario(
    car.listing.price,
    applied,
    credit.estimatedApr.min,
    credit.estimatedApr.max,
    before.termMonths,
    affordability.maxSustainablePayment,
  );

  return (
    <div className="bg-card border border-line rounded-2xl p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg bg-teal-paper flex items-center justify-center shrink-0">
            <Wallet className="w-4.5 h-4.5 text-teal-deep" />
          </span>
          <div>
            <p className="font-medium">Down payment what-if</p>
            <p className="text-xs text-ink-soft">
              Est. {before.apr.toFixed(2)}% APR · {before.termMonths} months · {car.listing.year} {car.listing.make} {car.listing.model}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <Slider
          label="Down payment"
          value={downPayment}
          min={0}
          max={maxDown}
          step={50}
          onChange={setDownPayment}
          formatValue={(v) => `$${v.toLocaleString()}`}
        />
      </div>

      <Button type="button" variant="secondary" size="md" className="mt-4" onClick={() => setApplied(downPayment)}>
        Apply
      </Button>

      <div className="mt-5 grid grid-cols-3 text-sm border-t border-line pt-4">
        <span className="text-ink-soft" />
        <span className="text-center text-xs font-medium text-ink-soft">Before</span>
        <span className="text-center text-xs font-medium text-teal-deep">After</span>

        <Row label="Monthly loan" before={`$${before.monthlyPayment}`} after={`$${after.monthlyPayment}`} />
        <Row
          label="Total interest"
          before={`$${before.totalInterest.toLocaleString()}`}
          after={`$${after.totalInterest.toLocaleString()}`}
        />
        <Row label="Total payments" before={`$${before.totalCost.toLocaleString()}`} after={`$${after.totalCost.toLocaleString()}`} />
      </div>
    </div>
  );
}

function Row({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <>
      <span className="py-2 text-ink-soft text-xs">{label}</span>
      <span className="py-2 text-center tabular">{before}</span>
      <span className="py-2 text-center tabular font-medium text-teal-deep">{after}</span>
    </>
  );
}
