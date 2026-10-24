"use client";

import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { BuyerNeed } from "@/lib/types";

interface ConsentStepProps {
  need: BuyerNeed;
  onApprove: () => void;
  onBack: () => void;
}

export function ConsentStep({ need, onApprove, onBack }: ConsentStepProps) {
  return (
    <div className="max-w-xl">
      <h1 className="font-display text-[2rem] sm:text-[2.4rem] leading-tight">
        One approval, then it runs on its own.
      </h1>
      <p className="mt-3 text-ink-soft">
        We need your go-ahead for a soft credit check. It&apos;s how this shows you real numbers instead of
        guesses.
      </p>

      <div className="mt-9 border border-line bg-paper-raised/60 p-6">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 mt-0.5 text-moss shrink-0" />
          <div>
            <p className="font-medium">This is a soft pull — it won&apos;t affect your credit score.</p>
            <p className="mt-1.5 text-sm text-ink-soft leading-relaxed">
              It&apos;s the same kind of check you&apos;d see on a pre-approval page, not a hard inquiry a lender
              runs when you formally apply.
            </p>
          </div>
        </div>

        <dl className="mt-6 pt-6 border-t border-line grid grid-cols-2 gap-y-3 text-sm">
          <dt className="text-ink-soft">Budget you gave us</dt>
          <dd className="text-right tabular">${need.maxMonthlyPayment}/mo</dd>
          <dt className="text-ink-soft">Timeframe</dt>
          <dd className="text-right">{weeksLabel(need.timeframeWeeks)}</dd>
          <dt className="text-ink-soft">What happens next</dt>
          <dd className="text-right">Credit, cash flow, listings, loan math — automatically</dd>
        </dl>
      </div>

      <div className="mt-8 flex items-center gap-4">
        <Button size="lg" onClick={onApprove}>
          Approve soft credit check
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}

function weeksLabel(weeks: number): string {
  if (weeks <= 2) return "2 weeks";
  if (weeks <= 4) return "a month";
  if (weeks <= 6) return "6 weeks";
  return "2 months";
}
