"use client";

import { ShieldCheck, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Gauge } from "@/components/ui/Gauge";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { EmptyPlanState } from "@/components/EmptyPlanState";
import { useAppState } from "@/lib/app-state";
import type { CreditFactor } from "@/lib/types";

const TIP_RULES: { match: RegExp; tip: string; detail: string }[] = [
  { match: /utilization/i, tip: "Lower card balances", detail: "Moving utilization below 30% may help." },
  { match: /payment/i, tip: "Pay every bill on time", detail: "Payment history has a large impact." },
  { match: /inquir/i, tip: "Limit new applications", detail: "Apply only when it supports your plan." },
  { match: /collection/i, tip: "Resolve collections", detail: "Paid or settled accounts report better over time." },
  { match: /history length/i, tip: "Let accounts age", detail: "Older accounts strengthen your average history." },
  { match: /public record/i, tip: "Address public records", detail: "Liens and judgments weigh heavily on your file." },
];

const FALLBACK_TIPS = [
  { tip: "Keep utilization low", detail: "Staying under 30% of your limit helps your score." },
  { tip: "Pay every bill on time", detail: "Payment history has a large impact." },
  { tip: "Limit new applications", detail: "Apply only when it supports your plan." },
];

function tipsFor(factors: CreditFactor[]) {
  const negative = factors.filter((f) => f.impact === "negative");
  const fromFactors = negative
    .map((f) => TIP_RULES.find((r) => r.match.test(f.label)))
    .filter((t): t is (typeof TIP_RULES)[number] => Boolean(t));

  const deduped: { tip: string; detail: string }[] = [];
  for (const t of [...fromFactors, ...FALLBACK_TIPS]) {
    if (deduped.length >= 3) break;
    if (!deduped.some((d) => d.tip === t.tip)) deduped.push(t);
  }
  return deduped;
}

export default function CreditProfilePage() {
  const { result } = useAppState();

  if (!result) return <EmptyPlanState title="No credit profile yet" />;

  const { credit } = result;
  const tips = tipsFor(credit.factors);

  return (
    <section className="mx-auto max-w-4xl px-6 py-12 sm:py-16">
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow icon={<ShieldCheck className="w-3.5 h-3.5" />}>Your credit</Eyebrow>
          <h1 className="font-display font-extrabold text-[2rem] sm:text-[2.5rem] leading-tight mt-2">Credit Profile</h1>
          <p className="mt-1 text-ink-soft">See what shapes your estimated loan rate.</p>
        </div>
        <Link
          href="/find-my-car"
          className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium border border-line rounded-full px-4 py-2 hover:border-ink/40"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Return to my plan
        </Link>
      </div>

      <div className="mt-8 grid sm:grid-cols-2 gap-5">
        <div className="bg-card border border-line rounded-2xl p-6 flex flex-col items-center justify-center">
          <p className="text-xs text-ink-soft mb-2">Estimated credit score</p>
          <Gauge value={credit.score} min={300} max={850} label={credit.tierLabel} />
        </div>

        <div className="bg-card border border-line rounded-2xl p-6">
          <p className="font-medium">Credit factors</p>
          <div className="mt-4 space-y-4">
            {credit.factors.map((factor) => (
              <FactorBar key={factor.label} factor={factor} />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 bg-card border border-line rounded-2xl p-6">
        <p className="font-medium">How Your Credit Affects Your Loan</p>
        <p className="text-sm text-ink-soft mt-1">
          Lenders often offer lower rates when a profile shows on-time payments, lower card balances, and a longer history.
        </p>
        <div className="mt-5">
          <div className="h-2.5 rounded-full bg-gradient-to-r from-teal to-gold" />
          <div className="mt-1.5 flex justify-between text-xs tabular">
            <span className="text-ink-soft">
              {Math.max(5, credit.estimatedApr.min - 2)}% <span className="text-ink-soft/70">Stronger profile</span>
            </span>
            <span className="font-medium">
              {credit.estimatedApr.min}–{credit.estimatedApr.max}% <span className="text-ink-soft font-normal">Current range</span>
            </span>
          </div>
        </div>
        <p className="mt-3 text-xs text-ink-soft">Estimated range, not an offer or guarantee.</p>
      </div>

      <div className="mt-5 bg-card border border-line rounded-2xl p-6">
        <p className="font-medium">Ways to improve</p>
        <div className="mt-4 grid sm:grid-cols-3 gap-5">
          {tips.map((t) => (
            <div key={t.tip} className="flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-teal mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">{t.tip}</p>
                <p className="text-xs text-ink-soft mt-0.5">{t.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FactorBar({ factor }: { factor: CreditFactor }) {
  const fill = factor.impact === "positive" ? "bg-teal" : factor.impact === "negative" ? "bg-gold" : "bg-ink-soft";
  const width = factor.impact === "positive" ? "85%" : factor.impact === "negative" ? "55%" : "70%";

  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{factor.label}</span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-paper-high overflow-hidden">
        <div className={`h-full rounded-full ${fill}`} style={{ width }} />
      </div>
      <p className="mt-1 text-xs text-ink-soft">{factor.detail}</p>
    </div>
  );
}
