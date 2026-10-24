"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { IntakeForm } from "@/components/flow/IntakeForm";
import { ConsentStep } from "@/components/flow/ConsentStep";
import { PipelineTimeline } from "@/components/flow/PipelineTimeline";
import { ResultsView } from "@/components/flow/ResultsView";
import { DealerPacketView } from "@/components/flow/DealerPacketView";
import type { BuyerNeed, PipelineResult } from "@/lib/types";

type Phase = "intake" | "consent" | "pipeline" | "results" | "packet";

function defaultNeed(params: URLSearchParams): BuyerNeed {
  const desc = params.get("desc");
  const budget = Number(params.get("budget"));
  const weeks = Number(params.get("weeks"));
  return {
    description: desc ? capitalize(desc) : "A reliable car to commute, nothing fancy.",
    maxMonthlyPayment: Number.isFinite(budget) && budget > 0 ? budget : 400,
    timeframeWeeks: Number.isFinite(weeks) && weeks > 0 ? weeks : 4,
    downPayment: 0,
    zip: "43215",
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function StartFlow() {
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>("intake");
  const [need, setNeed] = useState<BuyerNeed>(() => defaultNeed(searchParams));
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [consentToken, setConsentToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
          {phase === "intake" && (
            <IntakeForm
              initial={need}
              onSubmit={(n) => {
                setNeed(n);
                setPhase("consent");
              }}
            />
          )}

          {phase === "consent" && (
            <ConsentStep
              need={need}
              onApprove={(token) => {
                setConsentToken(token);
                setPhase("pipeline");
              }}
              onBack={() => setPhase("intake")}
            />
          )}

          {phase === "pipeline" && consentToken && (
            <PipelineTimeline
              need={need}
              consentToken={consentToken}
              onComplete={(r) => {
                // The token is single-use; a new run asks for consent again.
                setConsentToken(null);
                setResult(r);
                setPhase("results");
              }}
              onError={(message) => {
                setConsentToken(null);
                setError(message);
                setPhase("intake");
              }}
            />
          )}

          {phase === "results" && result && (
            <ResultsView
              result={result}
              onGetPacket={() => setPhase("packet")}
              onStartOver={() => {
                setResult(null);
                setPhase("intake");
              }}
            />
          )}

          {phase === "packet" && result && (
            <DealerPacketView result={result} onBack={() => setPhase("results")} />
          )}

          {error && (
            <p className="mt-6 text-sm text-rust max-w-xl">{error}</p>
          )}
        </section>
      </main>
    </>
  );
}

export default function StartPage() {
  return (
    <Suspense fallback={null}>
      <StartFlow />
    </Suspense>
  );
}
