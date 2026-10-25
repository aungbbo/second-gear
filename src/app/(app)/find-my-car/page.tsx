"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { IntakeForm } from "@/components/flow/IntakeForm";
import { ConsentStep } from "@/components/flow/ConsentStep";
import { PipelineTimeline } from "@/components/flow/PipelineTimeline";
import { ResultsView } from "@/components/flow/ResultsView";
import { DecisionGuide } from "@/components/flow/DecisionGuide";
import { DealerPacketView } from "@/components/flow/DealerPacketView";
import { useAppState } from "@/lib/app-state";
import type { BuyerNeed } from "@/lib/types";

type Phase = "intake" | "consent" | "pipeline" | "results" | "decision" | "packet";

function defaultNeed(params: URLSearchParams): BuyerNeed {
  const budget = Number(params.get("budget"));
  const weeks = Number(params.get("weeks"));
  return {
    description: "A reliable car to commute, nothing fancy.",
    maxMonthlyPayment: Number.isFinite(budget) && budget > 0 ? budget : 400,
    timeframeWeeks: Number.isFinite(weeks) && weeks > 0 ? weeks : 4,
    downPayment: 0,
    zip: "43215",
  };
}

function FindMyCarFlow() {
  const searchParams = useSearchParams();
  const { result, setResult } = useAppState();
  const [phase, setPhase] = useState<Phase>(result ? "results" : "intake");
  const [need, setNeed] = useState<BuyerNeed>(() => defaultNeed(searchParams));
  const [consentToken, setConsentToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="mx-auto max-w-6xl px-6 py-12 sm:py-16">
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
            // A Credit Profile is backed by the last completed pipeline result.
            // Clear it before a fresh run so a failed live request can't leave
            // an older mock profile looking like the new result.
            setResult(null);
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
        <ResultsView result={result} onBack={() => setPhase("intake")} onCompare={() => setPhase("decision")} />
      )}

      {phase === "decision" && result && (
        <DecisionGuide result={result} onBack={() => setPhase("results")} onGetPacket={() => setPhase("packet")} />
      )}

      {phase === "packet" && result && <DealerPacketView result={result} onBack={() => setPhase("decision")} />}

      {error && <p className="mt-6 text-sm text-rust max-w-xl mx-auto text-center">{error}</p>}
    </section>
  );
}

export default function FindMyCarPage() {
  return (
    <Suspense fallback={null}>
      <FindMyCarFlow />
    </Suspense>
  );
}
