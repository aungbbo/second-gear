"use client";

import { useState } from "react";
import { ShieldCheck, Landmark, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Toggle } from "@/components/ui/Toggle";
import type { BuyerNeed } from "@/lib/types";

/** Must match SOFT_PULL_CONSENT_VERSION on the server; bump both when the consent text changes. */
const CONSENT_TEXT_VERSION = "soft-pull-v1";

interface ConsentStepProps {
  need: BuyerNeed;
  /** Called with the server-issued consent token once the approval is recorded. */
  onApprove: (consentToken: string) => void;
  onBack: () => void;
}

export function ConsentStep({ need, onApprove, onBack }: ConsentStepProps) {
  const [creditOn, setCreditOn] = useState(false);
  const [cashFlowOn, setCashFlowOn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bothOn = creditOn && cashFlowOn;

  async function approve() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ softPullAuthorized: true, textVersion: CONSENT_TEXT_VERSION }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body.consentToken !== "string") throw new Error(body.error ?? "We couldn't record your approval.");
      onApprove(body.consentToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't record your approval.");
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <ChevronLeft className="w-4 h-4" /> Back
      </button>

      <div className="mt-6 text-center">
        <Eyebrow icon={<ShieldCheck className="w-3.5 h-3.5" />}>Your permission matters</Eyebrow>
        <h1 className="font-display font-extrabold text-[2rem] sm:text-[2.5rem] leading-tight mt-3">
          Choose what to include.
        </h1>
      </div>

      <div className="mt-8 space-y-4">
        <div className={`flex items-start gap-4 rounded-2xl border p-5 ${creditOn ? "border-teal" : "border-line"}`}>
          <span className="w-10 h-10 rounded-xl bg-teal-paper flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-teal-deep" />
          </span>
          <div className="flex-1">
            <p className="font-medium">Credit analysis</p>
            <p className="text-sm text-ink-soft mt-0.5">Uses your credit profile to estimate an APR.</p>
            <p className="text-xs text-teal-deep mt-1">No real credit inquiry is made</p>
          </div>
          <Toggle checked={creditOn} onChange={setCreditOn} label="Include credit analysis" />
        </div>

        <div className={`flex items-start gap-4 rounded-2xl border p-5 ${cashFlowOn ? "border-teal" : "border-line"}`}>
          <span className="w-10 h-10 rounded-xl bg-teal-paper flex items-center justify-center shrink-0">
            <Landmark className="w-5 h-5 text-teal-deep" />
          </span>
          <div className="flex-1">
            <p className="font-medium">Cash flow analysis</p>
            <p className="text-sm text-ink-soft mt-0.5">Uses your income and spending to test affordability.</p>
            <p className="text-xs text-teal-deep mt-1">No real account is connected</p>
          </div>
          <Toggle checked={cashFlowOn} onChange={setCashFlowOn} label="Include cash flow analysis" />
        </div>
      </div>

      <div className="mt-6 bg-teal-paper/60 rounded-2xl p-5 grid grid-cols-2 gap-4 text-center text-xs text-ink-soft">
        <div>
          <p className="font-medium text-ink">Nothing shared with dealers</p>
        </div>
        <div>
          <p className="font-medium text-ink">No transfers or applications</p>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-y-2 text-sm text-ink-soft">
        <dt>Budget you gave us</dt>
        <dd className="text-right tabular text-ink">${need.maxMonthlyPayment}/mo</dd>
        <dt>Timeframe</dt>
        <dd className="text-right text-ink">{weeksLabel(need.timeframeWeeks)}</dd>
      </dl>

      <Button size="lg" onClick={approve} disabled={!bothOn || submitting} className="mt-8 w-full justify-center">
        {submitting ? "Recording approval…" : "Continue →"}
      </Button>
      <p className="mt-2 text-center text-xs text-ink-soft">
        {bothOn ? "Both analyses selected." : "Turn on both to continue."}
      </p>
      {error && <p className="mt-4 text-sm text-rust text-center">{error}</p>}
    </div>
  );
}

function weeksLabel(weeks: number): string {
  if (weeks <= 2) return "2 weeks";
  if (weeks <= 4) return "a month";
  if (weeks <= 6) return "6 weeks";
  return "2 months";
}
