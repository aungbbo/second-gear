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
  const insights = credit.insights;
  const latePaymentCount = insights?.latePayments
    ? insights.latePayments.thirtyDays + insights.latePayments.sixtyDays + insights.latePayments.ninetyPlusDays
    : undefined;

  return (
    <section className="mx-auto max-w-4xl px-6 py-12 sm:py-16">
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow icon={<ShieldCheck className="w-3.5 h-3.5" />}>Your credit</Eyebrow>
          <h1 className="font-display font-extrabold text-[2rem] sm:text-[2.5rem] leading-tight mt-2">Credit Profile</h1>
          <p className="mt-1 text-ink-soft">See what shapes your estimated loan rate.</p>
          {credit.source && (
            <p className="mt-2 inline-flex rounded-full bg-teal-paper px-3 py-1 text-xs font-medium text-teal-deep">
              {credit.source.mode === "crs_sandbox"
                ? `${credit.source.bureau} sandbox · ${credit.source.personaId}`
                : "Generated demo profile · mock data"}
            </p>
          )}
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
          {credit.insights?.scorePercentile !== undefined && (
            <p className="mt-3 text-sm text-ink-soft">
              <span className="font-semibold text-ink">{ordinal(credit.insights.scorePercentile)} percentile</span> rank
            </p>
          )}
        </div>

        <div className="bg-card border border-line rounded-2xl p-6">
          <p className="font-medium">What contributes to this score</p>
          <p className="mt-1 text-xs text-ink-soft">
            {credit.source?.mode === "crs_sandbox" && credit.insights
              ? `Score factors reported by ${credit.insights.bureau}.`
              : "Bureau-reported score factors appear here when a CRS report is used."}
          </p>
          {credit.bureauScoreFactors?.length ? (
            <div className="mt-4 space-y-3">
              {credit.bureauScoreFactors.map((factor, index) => (
                <div key={`${index}-${factor}`} className="rounded-xl bg-paper px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">Bureau factor {index + 1}</p>
                    <span className="shrink-0 rounded-full bg-gold-paper px-2.5 py-1 text-[11px] font-medium text-gold-deep">
                      Reported by CRS
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{factor}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-xl bg-paper px-4 py-3 text-sm text-ink-soft">
              No bureau score factors were included in this report.
            </p>
          )}
          <p className="mt-3 text-xs text-ink-soft">
            CRS provides these reason factors but no percentage weights for how much each one contributes.
          </p>
        </div>
      </div>

      {insights && (
        <div className="mt-5 bg-card border border-line rounded-2xl p-6">
          <p className="font-medium">What’s in your credit report</p>
          <p className="mt-1 text-xs text-ink-soft">
            {insights.bureau} · {insights.scoreModel}
            {insights.reportDate ? ` · Reported ${formatReportDate(insights.reportDate)}` : ""}
          </p>
          <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {insights.revolvingUtilizationPercent !== undefined && (
              <ReportMetric
                label="Card utilization"
                value={`${Math.round(insights.revolvingUtilizationPercent)}%`}
                detail="Share of revolving credit currently used. Lower is generally better."
              />
            )}
            {insights.accountCount !== undefined && (
              <ReportMetric label="Accounts reported" value={String(insights.accountCount)} detail="Credit accounts found in this bureau file." />
            )}
            {insights.creditHistoryYears !== undefined && (
              <ReportMetric
                label="Credit history"
                value={`About ${insights.creditHistoryYears} ${insights.creditHistoryYears === 1 ? "year" : "years"}`}
                detail="Based on the oldest account reported."
              />
            )}
            {latePaymentCount !== undefined && insights.latePayments && (
              <ReportMetric
                label="Late payments reported"
                value={latePaymentCount === 0 ? "None reported" : String(latePaymentCount)}
                detail={`${insights.latePayments.thirtyDays} at 30 days · ${insights.latePayments.sixtyDays} at 60 days · ${insights.latePayments.ninetyPlusDays} at 90+ days`}
              />
            )}
            {(insights.collections !== undefined || insights.chargeOffs !== undefined) && (
              <ReportMetric
                label="Collections and charge-offs"
                value={`${insights.collections ?? 0} collections · ${insights.chargeOffs ?? 0} charge-offs`}
                detail="Negative account records reported by this bureau."
              />
            )}
            {insights.pastDueBalance !== undefined && (
              <ReportMetric
                label="Past-due balance"
                value={formatCurrency(insights.pastDueBalance)}
                detail="Total past-due amount reported across accounts."
              />
            )}
            {insights.inquiriesLast6Months !== undefined && (
              <ReportMetric
                label="Recent inquiries"
                value={String(insights.inquiriesLast6Months)}
                detail="Inquiries dated within the last six months; the report doesn’t identify which were hard pulls."
              />
            )}
            {insights.publicRecords !== undefined && (
              <ReportMetric label="Public records" value={String(insights.publicRecords)} detail="Bankruptcies, liens, or judgments reported in this file." />
            )}
          </div>
          <p className="mt-4 text-xs text-ink-soft">
            This is one bureau’s report snapshot. Account details are summarized here; the report may not include every bureau or the latest activity.
          </p>
        </div>
      )}

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

function formatReportDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString();
}

function ordinal(value: number): string {
  const rounded = Math.round(value);
  const remainder100 = rounded % 100;
  const suffix = remainder100 >= 11 && remainder100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[rounded % 10] ?? "th";
  return `${rounded}${suffix}`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function ReportMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl bg-paper px-4 py-3">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="mt-1 font-display font-bold text-lg tabular">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">{detail}</p>
    </div>
  );
}
